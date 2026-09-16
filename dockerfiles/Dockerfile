# ── Stage 1: Build React frontend ──
FROM registry.access.redhat.com/ubi9/nodejs-20:latest AS frontend-builder

USER 0
WORKDIR /build

COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --legacy-peer-deps

COPY frontend/ ./
RUN npx tsc -p tsconfig.build.json && npx vite build


# ── Stage 2: Install Python dependencies ──
FROM registry.access.redhat.com/ubi9/python-311:latest AS python-builder

USER 0
WORKDIR /build

RUN dnf install -y gcc && dnf clean all

COPY requirements.txt ./
RUN python3 -m venv /opt/venv && \
    /opt/venv/bin/pip install --no-cache-dir --upgrade pip && \
    /opt/venv/bin/pip install --no-cache-dir -r requirements.txt


# ── Stage 3: Production image ──
FROM registry.access.redhat.com/ubi9/python-311:latest

USER 0
WORKDIR /app

# Install oc CLI (pinned version for reproducible builds; auto-detect arch)
# Update OC_VERSION when the target cluster is upgraded. Check client-server
# version skew policy: https://kubernetes.io/releases/version-skew-policy/
ARG OC_VERSION=4.14.40
RUN ARCH=$(uname -m) && \
    OC_SUFFIX="" && \
    if [ "$ARCH" = "aarch64" ]; then OC_SUFFIX="-arm64"; fi && \
    curl -sL "https://mirror.openshift.com/pub/openshift-v4/clients/ocp/${OC_VERSION}/openshift-client-linux${OC_SUFFIX}.tar.gz" \
    | tar xzf - -C /usr/local/bin oc kubectl && \
    chmod +x /usr/local/bin/oc /usr/local/bin/kubectl && \
    oc version --client

# Install git (for agnosticv_resolver.py's shallow clone of rhpds/agnosticv)
RUN dnf install -y git && dnf clean all

# Install the agnosticv CLI (same public, unauthenticated binary agnosticv-operator
# vendors; pinned to v0.7.1 to match). Used by agnosticv_resolver.py to merge
# catalog item YAML and read tenant_cluster.item.
ARG AGNOSTICV_VERSION=0.7.1
RUN curl -sL "https://github.com/redhat-cop/agnosticv/releases/download/v${AGNOSTICV_VERSION}/agnosticv_linux_amd64" \
    -o /usr/local/bin/agnosticv && \
    chmod +x /usr/local/bin/agnosticv && \
    agnosticv --version

# Copy Python venv from builder
COPY --from=python-builder /opt/venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH" \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

# Copy version file and application source
COPY VERSION ./
COPY rhdp_flow.py ./
COPY lib/ ./lib/
COPY api/ ./api/
COPY docs/examples/ ./docs/examples/

# Copy built frontend from stage 1
COPY --from=frontend-builder /build/dist ./frontend/dist

# Create logs directory
RUN mkdir -p /app/logs && chown -R 1001:0 /app && chmod -R g=u /app

USER 1001

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -sf http://localhost:8000/api/health || exit 1

ENTRYPOINT ["uvicorn", "api.server:app", "--host", "0.0.0.0", "--port", "8000"]
