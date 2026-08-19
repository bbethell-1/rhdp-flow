# Flow Deployment to Infra01 Dev

## Access
- URL: https://rhdp-flow-dev.apps.ocpv-infra01.dal12.infra.demo.redhat.com/
- Namespace: rhdp-flow-dev
- Cluster: ocpv-infra01.dal12.infra.demo.redhat.com

## Deployment Commands
```bash
oc login --server=https://api.ocpv-infra01.dal12.infra.demo.redhat.com:6443
oc apply -k openshift/overlays/infra-dev/
oc rollout status deployment/rhdp-scheduler -n rhdp-flow-dev
```

## Trigger New Build
```bash
oc start-build rhdp-scheduler --from-dir=. --follow -n rhdp-flow-dev
```

## Monitoring
```bash
# Check pods
oc get pods -n rhdp-flow-dev

# View logs
oc logs -f -n rhdp-flow-dev -l app.kubernetes.io/name=rhdp-scheduler

# Check route
oc get route rhdp-scheduler -n rhdp-flow-dev

# Test health endpoint
curl https://rhdp-flow-dev.apps.ocpv-infra01.dal12.infra.demo.redhat.com/api/health
```

## Known Issues

### Missing OC Client in Container
The Dockerfile temporarily has the `oc` CLI installation commented out due to network connectivity issues during builds (slow downloads from mirror.openshift.com). This causes the health endpoint to report errors about the missing `oc` command.

**Impact**: Base domain auto-detection and cluster connectivity checks fail in the health endpoint.

**Workaround**: The application uses the Kubernetes Python client for core functionality and should work despite the health check warnings.

**Resolution**: Uncomment the OC installation section in `dockerfiles/Dockerfile` lines 34-44 once network issues are resolved or use a faster mirror.

## Resources Created
- ServiceAccount: `rhdp-scheduler`
- ClusterRole: `rhdp-scheduler`
- ClusterRoleBinding: `rhdp-scheduler`
- ConfigMap: `rhdp-scheduler-config`
- Deployment: `rhdp-scheduler`
- Service: `rhdp-scheduler-service`
- Route: `rhdp-scheduler`
- BuildConfig: `rhdp-scheduler`
- ImageStream: `rhdp-scheduler`
- NetworkPolicy: `rhdp-scheduler`
