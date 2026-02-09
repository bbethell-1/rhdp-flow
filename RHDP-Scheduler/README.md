# RHDP-Flow: Red Hat Demo Platform Workshop Automation Tool

Automates scheduling and deployment for RHDP workshops with safety features.

## Features

- **CSV Input**: Reads workshop schedules from CSV files
- **Mass Deployment**: Generates deployments for multiple users (default: 20)
- **API Integration**: Uses `requests` library to POST ResourceClaims to Babylon API
- **Safety First**: 
  - `--dry-run` flag prints JSON payloads without sending
  - Quota checking validates region capacity
  - Comprehensive error handling
- **QA Verification**: Verifies deployments using `oc get routes` and HTTP health checks
- **Results Export**: Writes GUIDs and URLs to CSV for student landing pages

## Installation

```bash
# Install dependencies
pip3 install -r requirements.txt
```

## CSV Format

The input CSV should have the following headers:

```
CI Name,CI,Namespace,Users,Enable_workshop_interface,Password,Auto-stop,Auto-destroy
```

Example:
```csv
CI Name,CI,Namespace,Users,Enable_workshop_interface,Password,Auto-stop,Auto-destroy
Experience OpenShift Virtualization Roadshow,openshift-cnv.ocp-virt-roadshow-multi-user.prod,user-bbethell-redhat-com,20,True,Billy1,09/02/26 18:00,12/02/26 11:00
```

## Usage

### Dry-Run Mode (Safe Preview)

```bash
python3 rhdp_flow.py \
  --input-csv workshop_schedule.csv \
  --ci openshift-cnv.ocp-virt-roadshow-multi-user.prod \
  --dry-run
```

### Actual Deployment

```bash
python3 rhdp_flow.py \
  --input-csv workshop_schedule.csv \
  --ci openshift-cnv.ocp-virt-roadshow-multi-user.prod \
  --babylon-url https://api.example.com:6443 \
  --babylon-token $BABYLON_TOKEN \
  --region us-east-1 \
  --kubeconfig ~/.kube/config
```

### With Debug Logging

```bash
python3 rhdp_flow.py \
  --input-csv workshop_schedule.csv \
  --ci openshift-cnv.ocp-virt-roadshow-multi-user.prod \
  --dry-run \
  --debug
```

## Command Line Arguments

- `--input-csv`: Path to input CSV file (required)
- `--output-csv`: Path to output CSV file (default: deployment_results.csv)
- `--ci`: Catalog Item ID to deploy (required)
- `--user-count`: Number of users to deploy (default: 20, overrides CSV if specified)
- `--dry-run`: Print JSON payloads without sending requests
- `--babylon-url`: Babylon/Kubernetes API server URL
- `--babylon-token`: Babylon API authentication token (or set BABYLON_TOKEN env var)
- `--kubeconfig`: Path to kubeconfig file for oc commands
- `--region`: AWS region for deployment (default: us-east-1)
- `--timeout`: Request timeout in seconds (default: 60)
- `--no-verify-ssl`: Disable SSL certificate verification (not recommended)
- `--debug`: Enable debug logging

## Output

The script generates `deployment_results.csv` with the following columns:

- `session_code`: Session identifier
- `session_name`: Session name
- `user`: User identifier
- `workshop_name`: Workshop name
- `catalog_item_id`: Catalog Item ID
- `guid`: Deployment GUID
- `url`: Workshop interface URL
- `namespace`: Kubernetes namespace
- `status`: Deployment status (verified, deployed_unverified, failed, error)
- `timestamp`: Deployment timestamp
- `error_message`: Error message if deployment failed

## Workshop URL Pattern

Workshop URLs follow this pattern:
```
https://integration.demo.redhat.com/workshops/user-{email}/{catalog-item}-{suffix}
```

Example:
```
https://integration.demo.redhat.com/workshops/user-bbethell-redhat-com/openshift-cnv.ocp-virt-roadshow-multi-user.prod-vt958
```

## Safety Features

1. **Dry-Run Mode**: Test deployments without making actual API calls
2. **Quota Checking**: Validates region capacity before deployment
3. **Error Handling**: Comprehensive error handling with detailed logging
4. **Verification**: Automatically verifies deployments are accessible

## Requirements

- Python 3.7+
- OpenShift CLI (`oc`) installed and configured
- Access to RHDP/Babylon API
- Valid authentication token

## License

Internal Red Hat tool for RHDP automation.
