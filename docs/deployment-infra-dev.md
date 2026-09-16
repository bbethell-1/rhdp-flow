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

## Labagator Integration

Flow integrates with the Labagator event planning tool for seamless session-to-workshop handoff.

### Import Workflow

1. In Flow Upload tab, locate the "Import from Labagator" card
2. Select an event from the dropdown (populated live from Labagator's API)
3. Enter the target namespace, adjusting Advanced options if needed
4. Click "Import" — Flow fetches a ready-made Flow-format CSV from Labagator and shows a confirmation dialog with the session count and event name
5. Click "Confirm" to load the sessions into the schedule table, or "Cancel" to discard the preview
6. Deploy as usual

CSV shaping (multi-asset grouping, password fill, namespace/concurrency/auto-stop/auto-destroy) is done server-side by Labagator's own export endpoint — Flow no longer re-derives this from raw session data.

### Export Workflow

1. Deploy workshops via Flow
2. In Deployments tab, click "Export for Labagator"
3. Import exported CSV back into Labagator for session updates

### API Endpoints

- List events: `GET /api/labagator/events`
- Preview sessions: `GET /api/schedules/labagator-preview?event_id=<id>&namespace=<ns>` (returns `{event_name, session_count, csv_text}`, does not ingest)
- Import sessions: `POST /api/schedules/import-from-labagator` (body: `{"csv_text": "<csv>", "filename": "<name>"}`, ingests the CSV returned by the preview call)
- Export: `GET /api/schedules/export-for-labagator`
