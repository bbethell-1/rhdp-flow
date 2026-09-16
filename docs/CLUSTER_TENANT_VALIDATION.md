# Cluster-Tenant Validation

## Overview

The cluster-tenant validation feature ensures that cluster catalog items are deployed before their corresponding tenant variants. This is critical for multi-tenant workshop deployments where the cluster infrastructure must exist before tenant workloads can be scheduled.

## How It Works

### Catalog Item Naming Convention

The validation logic recognizes catalog items with specific suffixes:

- **Cluster variant**: `workshop.prod` (base name) or `workshop.prod-cluster` (explicit)
- **Tenant variant**: `workshop.prod-tenant`

### Validation Rules

1. **Tenant before cluster (ERROR)**: If a tenant variant is scheduled before its cluster variant, an error is returned
2. **Tenant without cluster (WARNING)**: If a tenant variant has no corresponding cluster variant, a warning is returned
3. **Cluster before tenant or same time (VALID)**: No errors or warnings

### Examples

#### Valid Ordering
```csv
CI Name,CI,Provisioning Date (UTC)
Cluster Workshop,workshop.prod,01/08/2026 09:00
Tenant Workshop,workshop.prod-tenant,01/08/2026 10:00
```
Result: ✅ No errors (cluster at 09:00, tenant at 10:00)

#### Invalid Ordering
```csv
CI Name,CI,Provisioning Date (UTC)
Tenant Workshop,workshop.prod-tenant,01/08/2026 09:00
Cluster Workshop,workshop.prod,01/08/2026 10:00
```
Result: ❌ Error (tenant at 09:00 before cluster at 10:00)

#### Missing Cluster
```csv
CI Name,CI,Provisioning Date (UTC)
Tenant Workshop,workshop.prod-tenant,01/08/2026 09:00
```
Result: ⚠️ Warning (tenant has no cluster)

## API Endpoint

### POST /api/schedules/validate-cluster-tenant

Validates cluster-tenant ordering for all loaded schedules.

#### Request
```bash
curl -X POST http://localhost:8000/api/schedules/validate-cluster-tenant
```

#### Response
```json
{
  "errors": [
    {
      "ci_name": "Tenant Workshop",
      "tenant_ci": "workshop.prod-tenant",
      "cluster_ci": "workshop.prod",
      "tenant_date": "01/08/2026 09:00",
      "cluster_date": "01/08/2026 10:00",
      "namespace": "user-test",
      "message": "Tenant variant 'workshop.prod-tenant' is scheduled before cluster variant 'workshop.prod'. Deploy cluster first."
    }
  ],
  "warnings": [
    {
      "ci_name": "Orphan Tenant",
      "tenant_ci": "another.prod-tenant",
      "namespace": "user-test",
      "message": "Tenant variant 'another.prod-tenant' has no corresponding cluster variant 'another.prod' scheduled."
    }
  ],
  "tenants_checked": 2,
  "clusters_found": 1
}
```

#### Response Fields

- `errors`: List of validation errors (tenant scheduled before cluster)
- `warnings`: List of validation warnings (tenant without cluster)
- `tenants_checked`: Total number of tenant catalog items found
- `clusters_found`: Number of tenants that have matching cluster items

## Usage

### Via API

1. Upload a CSV with both cluster and tenant variants
2. Call the validation endpoint
3. Check the response for errors and warnings
4. Fix any issues before deploying

### Example Workflow

```bash
# 1. Upload CSV
curl -X POST http://localhost:8000/api/schedules/upload \
  -F "file=@workshop.csv"

# 2. Validate cluster-tenant ordering
curl -X POST http://localhost:8000/api/schedules/validate-cluster-tenant

# 3. If no errors, proceed with deployment
curl -X POST http://localhost:8000/api/deploy
```

## Testing

The feature includes comprehensive test coverage:

- **Unit tests**: `tests/test_cluster_tenant_validation.py` (8 tests)
- **API tests**: `tests/test_api_cluster_tenant.py` (4 tests)

Run tests:
```bash
pytest tests/test_cluster_tenant_validation.py tests/test_api_cluster_tenant.py -v
```

## Implementation Details

### Files

- `cluster_tenant_validation.py`: Core validation logic
- `api/models.py`: Pydantic response models
- `api/routes.py`: FastAPI endpoint

### Validation Function

```python
from cluster_tenant_validation import validate_cluster_before_tenant

schedules = [...]  # List of WorkshopSchedule objects
result = validate_cluster_before_tenant(schedules)
```

Returns a dict with `errors`, `warnings`, `tenants_checked`, and `clusters_found`.

## Future Enhancements

1. **Automatic CSV reordering**: Offer to automatically fix ordering issues
2. **Frontend integration**: Display validation results in the UI
3. **Pre-deploy hook**: Automatically run validation before deployment
4. **Multi-region support**: Validate cluster-tenant ordering across regions
5. **Custom time buffer**: Allow configurable minimum delay between cluster and tenant deployment
