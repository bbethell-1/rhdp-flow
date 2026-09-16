Set up three deployment options for this app:

1. **dev.sh** — Local dev server hot-reload (for development)
2. **deploy-local.sh** — Podman container build + run locally (for integration testing)
3. **deploy.sh** — Remote OpenShift cluster deploy via Kustomize + binary build (for staging/prod)

### Files to create:

**dockerfiles/Dockerfile** (multi-stage):
- Stage 1: Build frontend (Node.js UBI9 image, npm ci, npm build)
- Stage 2: Install backend dependencies (Python/Node UBI9 image)
- Stage 3: Production image (UBI9), copy venv/deps + app source + built frontend,
  install oc CLI from mirror.openshift.com, run as non-root user 1001,
  expose app port, add HEALTHCHECK

**tsconfig.build.json** (if TypeScript frontend):
- Extends tsconfig.json, excludes test files (__tests__, *.test.ts, *.spec.ts, src/test)
- Dockerfile should run `npx tsc -p tsconfig.build.json && npx vite build` instead of `npm run build`

**.containerignore**:
- Exclude: node_modules, __pycache__, .venv, .git, .vscode, .claude, .memory,
  videos, screenshots (*.png, *.webm, *.mp4), test directories (__tests__, src/test,
  *.test.ts, *.test.tsx, *.spec.ts, *.spec.tsx), tests/, .env files

**dev.sh** (Vite/dev server workflow):
- Start both frontend and backend dev servers in background
- Wait for both to be healthy
- Subcommands: start (default), stop, status
- Use project-specific ports that avoid 8000 and 5173 range

**deploy-local.sh** (Podman container):
- Auto-detect host architecture (arm64/aarch64 → linux/arm64, else linux/amd64)
- Build image with podman using .containerignore
- Run container with: env vars for logging, mount host kubeconfig read-only
  (-v $HOME/.kube/config:/app/.kube/config:ro,Z -e KUBECONFIG=/app/.kube/config)
- Health check loop (poll health endpoint for up to 20s)
- Default port: 9090 (override via PORT env var)
- Subcommands: build, run, stop, logs, status, or no arg for build+run
- Image tag: localhost/<app-name>:dev
- Container name: <app-name>-dev

**deploy.sh** (remote OpenShift):
- Takes env argument: ./deploy.sh [dev|prod] or ./deploy.sh [dev|prod] dry-run
- Steps:
  1. Create namespace if not exists
  2. Create ServiceAccount if not exists
  3. Apply Kustomize manifests (oc apply -k overlay)
  4. Create ClusterRoleBinding (cluster-reader) for SA if not exists
  5. Binary build: oc start-build <app> --from-dir=. -n <ns> --follow
     (NOT git source — avoids private repo and submodule issues)
  6. Check build status, rollout restart, wait for rollout
  7. Print route URL on completion
- Dry-run mode: render manifests with oc kustomize and exit
- Verify oc login before proceeding

**openshift/base/kustomization.yaml**:
- Resources: deployment, service, route, buildconfig, imagestream, configmap
- Common labels: app.kubernetes.io/name, app.kubernetes.io/part-of

**openshift/base/deployment.yaml**:
- Annotation: image.openshift.io/triggers pointing to ImageStreamTag
- ServiceAccount, envFrom ConfigMap, liveness/readiness probes on health endpoint
- Resource requests/limits, emptyDir volume for logs

**openshift/base/service.yaml**: ClusterIP, target app port
**openshift/base/route.yaml**: TLS edge termination, 300s timeout
**openshift/base/imagestream.yaml**: lookupPolicy.local: true
**openshift/base/configmap.yaml**: LOG_FORMAT, LOG_LEVEL, UVICORN_WORKERS (or equivalent)
**openshift/base/buildconfig.yaml**:
- source.type: Binary (with binary: {}), NOT Git
- strategy: Docker, dockerfilePath: dockerfiles/Dockerfile
- output: ImageStreamTag <app>:latest
- triggers: ConfigChange only (no webhook for binary builds)

**openshift/overlays/dev/kustomization.yaml**:
- namespace: <app>-dev
- Patches: 1 replica, lower memory (128Mi-256Mi)

**openshift/overlays/prod/kustomization.yaml**:
- namespace: <app>
- Patches: 2 replicas, higher memory (256Mi-1Gi), higher build memory (4Gi)

### Cross-referencing:
All three scripts must include this header block showing all deployment options:
```
# Deployment options:
#   1. ./dev.sh               — Dev servers (hot-reload, for development)
#   2. ./deploy-local.sh      — Podman container (for local integration testing)
#   3. ./deploy.sh [dev|prod] — Remote OpenShift cluster (for staging/production)
```

### Important:
- All shell scripts must have LF line endings (not CRLF)
- Make all .sh files executable (chmod +x)
- No AI attribution in git commits
- Commit and push when done

### App details (fill these in):
- App name: $ARGUMENTS
- Frontend: [framework + build tool, e.g. React + Vite]
- Backend: [framework, e.g. FastAPI / Express / Go]
- Health endpoint: [path, e.g. /api/health]
- App port: [e.g. 8000]
- Dev frontend port: [e.g. 6500]
- Dev backend port: [e.g. 5500]
- Namespace: [dev name, e.g. my-app-dev] / [prod name, e.g. my-app]
