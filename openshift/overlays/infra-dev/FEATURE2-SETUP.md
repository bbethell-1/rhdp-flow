# Feature 2 — Multi-cluster deploy picker (infra01 setup)

This overlay adds two things to the infra01 `rhdp-flow` instance:

1. **Identity gate** — an `oauth-proxy` sidecar in front of the whole web UI,
   restricted to an email allowlist (Josh + Billy).
2. **Deploy-target picker** — an operator-only dropdown in Deploy Settings that
   deploys the loaded schedule (CSV upload *or* Labagator import) to one of
   several physical clusters. Defaults to **Events (us-west-2)** when that
   target Secret exists; operators can still choose this cluster (infra01),
   integration, or prod.

Everything committed to git is non-secret. The two live credentials — the
oauth cookie secret and the per-target-cluster ServiceAccount tokens — are
created directly in-cluster and never committed (etcd at-rest encryption is off
on infra01, so these are base64-only; accepted tradeoff for now).

## 1. OAuth cookie secret (one-time)

The sidecar signs its session cookies with a random key mounted from the
`rhdp-scheduler-oauth` Secret. Create it once:

```sh
oc create secret generic rhdp-scheduler-oauth -n rhdp-flow \
  --from-literal=cookie-secret="$(openssl rand -base64 32)"
```

The serving cert (`rhdp-scheduler-tls`) is minted automatically by the
service-ca operator from the annotation on the Service — nothing to do.

The allowlist itself lives in `oauth-proxy.yaml` (`authenticated-emails.txt`).
Keep it in sync with the app-side `DEPLOY_PICKER_ALLOWED_EMAILS` allowlist
(defaults to the same two operators in `api/identity.py`).

## 2. Target-cluster ServiceAccounts + Secrets (per target cluster)

Each deploy target is described by a Secret named `cluster-<key>` in the
`rhdp-flow` namespace, labelled `rhdp-flow.redhat.com/cluster-target=true`, with
keys: `server`, `token`, `ca.crt` (optional), `display-name` (optional). The app
reads these to build an ephemeral kubeconfig at deploy time
(`api/cluster_targets.py`).

Current targets:

| key           | cluster                                                    |
|---------------|------------------------------------------------------------|
| `events`      | `api.ocp-us-west-2.infra.open.redhat.com:6443`             |
| `integration` | `api.ocp-integration.infra.open.redhat.com:6443`          |
| `prod`        | `api.ocp-us-east-1.infra.open.redhat.com:6443`            |

### On each target cluster — create the scheduler ServiceAccount + long-lived token

Replicate the `rhdp-scheduler` ClusterRole (see `openshift/base/clusterrole.yaml`)
on the target, then:

```sh
# --- run against each TARGET cluster ---
oc create sa rhdp-scheduler -n rhdp-flow
oc adm policy add-cluster-role-to-user rhdp-scheduler -z rhdp-scheduler -n rhdp-flow

# Long-lived token (does not expire like `oc create token`):
cat <<'EOF' | oc apply -f -
apiVersion: v1
kind: Secret
metadata:
  name: rhdp-scheduler-token
  namespace: rhdp-flow
  annotations:
    kubernetes.io/service-account.name: rhdp-scheduler
type: kubernetes.io/service-account-token
EOF

TOKEN=$(oc get secret rhdp-scheduler-token -n rhdp-flow -o jsonpath='{.data.token}' | base64 -d)
SERVER=$(oc whoami --show-server)
CA=$(oc get secret rhdp-scheduler-token -n rhdp-flow -o jsonpath='{.data.ca\.crt}' | base64 -d)
```

### On infra01 — store it as a cluster-target Secret

```sh
# --- run against INFRA01 (rhdp-flow namespace) ---
oc create secret generic cluster-events -n rhdp-flow \
  --from-literal=server="$SERVER" \
  --from-literal=token="$TOKEN" \
  --from-literal=display-name="Events (us-west-2)"
# add ca.crt with --from-literal=ca.crt="$CA" (recommended for prod targets)

oc label secret cluster-events -n rhdp-flow rhdp-flow.redhat.com/cluster-target=true
```

Repeat for `cluster-integration` and `cluster-prod`. The picker in the UI shows
exactly the set of `cluster-*` secrets carrying the label; delete a secret to
remove a target.

## How it fits together

- Browser → Route (reencrypt) → `oauth-proxy` sidecar (:8443) → app (:8000).
- The proxy admits only allowlisted emails and injects `X-Forwarded-Email`.
- The app trusts that header only because the proxy is the sole ingress path
  (the NetworkPolicy exposes :8443 to the router, never :8000).
- Choosing a non-default target on deploy re-checks the allowlist in-app
  (`require_picker_access`) and resolves the matching `cluster-<key>` Secret into
  a short-lived kubeconfig, deleted when the deploy finishes.
