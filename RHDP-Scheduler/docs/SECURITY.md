# RHDP-Flow Security Guide

## CORS Configuration

By default, RHDP-Flow allows requests from `localhost:5173` and `localhost:8000` only.

To allow additional origins, set the `CORS_ORIGINS` environment variable:

```bash
export CORS_ORIGINS="https://rhdp-flow.example.com,https://admin.example.com"
```

## API Key Authentication

Optional API key protection for mutation endpoints (POST). When enabled, all
deploy, operations, and modification endpoints require the `X-API-Key` header.

**Setup:**

```bash
# Generate a strong key
export RHDP_API_KEY=$(openssl rand -hex 32)
```

**Usage:**

```bash
# API calls must include the key
curl -X POST http://localhost:8000/api/deploy \
  -H "X-API-Key: $RHDP_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"dry_run": true}'
```

The frontend stores the API key in `localStorage` under `rhdp-api-key` and
includes it automatically on all requests.

**When disabled (default):** If `RHDP_API_KEY` is not set, all endpoints are
accessible without authentication.

## Content Security Policy (CSP)

All responses include CSP headers that restrict resource loading:

- `default-src 'self'` — only load resources from same origin
- `script-src 'self'` — only execute same-origin scripts
- `style-src 'self' 'unsafe-inline'` — allow inline styles (required by PatternFly)
- `X-Content-Type-Options: nosniff` — prevent MIME sniffing
- `X-Frame-Options: DENY` — prevent iframe embedding

## Rate Limiting

POST endpoints: 60 requests/minute per IP
GET endpoints: 120 requests/minute per IP (default)

Rate limits are enforced via SlowAPI when installed. Exceeding limits returns
HTTP 429 (Too Many Requests).

## KUBECONFIG Handling

- RHDP-Flow uses the `KUBECONFIG` environment variable to locate cluster credentials
- Never commit kubeconfig files to version control
- Use short-lived service account tokens in production
- The health endpoint validates cluster connectivity without exposing credentials

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `CORS_ORIGINS` | localhost only | Comma-separated allowed origins |
| `RHDP_API_KEY` | *(unset = no auth)* | API key for mutation endpoints |
| `KUBECONFIG` | `~/.kube/config` | Path to kubeconfig file |

## API Versioning

All endpoints are available at both `/api/` (backward-compatible) and `/api/v1/`.
Future breaking changes will be introduced under `/api/v2/` while maintaining
the previous version.
