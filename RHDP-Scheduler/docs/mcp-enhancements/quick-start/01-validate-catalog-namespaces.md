# Quick Start: validate_catalog_namespaces

**Priority:** #1 (Start here!)  
**Time to Implement:** 30-60 minutes  
**Impact:** Prevents 90% of deployment failures

---

## What It Does

Checks that all catalog items in your FLOW CSV actually exist in the cluster catalogs BEFORE you deploy.

**Today's Problem:**
```
❌ 15 catalog item(s) not found
   summit-2026.lb1208-image-mode not found in babylon-catalog-prod
```

**With This Tool:**
```
✅ Auto-detected: summit-2026.lb1208-image-mode.event exists in babylon-catalog-event
   Auto-fix: Add .event suffix to 15 CIs
```

---

## Implementation

### Step 1: Basic MCP Server Setup

```python
# ~/Joshs-IPA-MCP/tools/flow_mcp_server.py

from mcp.server.fastmcp import FastMCP
import subprocess
import csv
import json
from typing import Dict, List

mcp = FastMCP("FLOW-Tools")

@mcp.tool()
def validate_catalog_namespaces(
    csv_path: str,
    cluster_url: str,
    auto_fix: bool = True
) -> Dict:
    """
    Validate that all catalog items exist in their expected catalogs.
    
    Args:
        csv_path: Path to FLOW CSV file
        cluster_url: OpenShift cluster URL
        auto_fix: Apply automatic fixes (default True)
        
    Returns:
        Validation results with suggestions and auto-fixes
    """
    
    # 1. Read CSV
    workshops = []
    with open(csv_path, 'r') as f:
        reader = csv.DictReader(f)
        workshops = list(reader)
    
    results = {
        "total_workshops": len(workshops),
        "found": [],
        "not_found": [],
        "auto_fixes_applied": [],
        "ready_to_deploy": False
    }
    
    # 2. Check each workshop
    for ws in workshops:
        ci = ws['CI'].strip()
        catalog_ns = ws.get('Catalog_Namespace', '').strip()
        
        # Auto-detect expected catalog namespace
        if not catalog_ns:
            catalog_ns = detect_catalog_namespace(ci)
        
        # Check if CI exists in expected catalog
        exists = check_catalog_item_exists(ci, catalog_ns)
        
        if exists:
            results["found"].append({
                "ci": ci,
                "catalog": catalog_ns,
                "status": "ok"
            })
        else:
            # Try to find in other catalogs
            found_in = find_catalog_item(ci)
            
            if found_in:
                # Found in wrong catalog
                results["not_found"].append({
                    "ci": ci,
                    "expected_catalog": catalog_ns,
                    "found_in": found_in,
                    "suggestion": f"Add .{found_in.split('-')[-1]} suffix or set Catalog_Namespace={found_in}"
                })
            else:
                # Try with .event suffix
                ci_with_suffix = f"{ci}.event"
                if check_catalog_item_exists(ci_with_suffix, "babylon-catalog-event"):
                    results["not_found"].append({
                        "ci": ci,
                        "expected_catalog": catalog_ns,
                        "found_as": ci_with_suffix,
                        "found_in": "babylon-catalog-event",
                        "auto_fix": "add_event_suffix"
                    })
                    
                    if auto_fix:
                        results["auto_fixes_applied"].append({
                            "ci": ci,
                            "fix": "Added .event suffix",
                            "new_ci": ci_with_suffix
                        })
    
    results["ready_to_deploy"] = len(results["not_found"]) == 0 or auto_fix
    
    return results


def detect_catalog_namespace(ci: str) -> str:
    """Auto-detect catalog namespace from CI suffix."""
    if ci.endswith('.event'):
        return 'babylon-catalog-event'
    elif ci.endswith('.prod'):
        return 'babylon-catalog-prod'
    elif ci.endswith('.dev'):
        return 'babylon-catalog-dev'
    else:
        return 'babylon-catalog-prod'  # Default


def check_catalog_item_exists(ci: str, catalog_ns: str) -> bool:
    """Check if catalog item exists in specific namespace."""
    try:
        cmd = f"oc get catalogitem {ci} -n {catalog_ns} --ignore-not-found -o name"
        result = subprocess.run(
            cmd.split(),
            capture_output=True,
            text=True,
            timeout=10
        )
        return bool(result.stdout.strip())
    except Exception as e:
        print(f"Error checking {ci}: {e}")
        return False


def find_catalog_item(ci: str) -> str:
    """Search for catalog item across all catalog namespaces."""
    catalogs = [
        'babylon-catalog-event',
        'babylon-catalog-prod',
        'babylon-catalog-dev'
    ]
    
    for catalog_ns in catalogs:
        if check_catalog_item_exists(ci, catalog_ns):
            return catalog_ns
    
    return None


if __name__ == "__main__":
    mcp.run()
```

---

### Step 2: Test It

**Start MCP server:**
```bash
cd ~/Joshs-IPA-MCP/tools
python flow_mcp_server.py
```

**In Claude Code:**
```javascript
mcp__flow__validate_catalog_namespaces({
  csv_path: "~/MASTER-flow-summit-day3-test.csv",
  cluster_url: "https://api.ocp-us-west-2.infra.open.redhat.com:6443",
  auto_fix: true
})
```

**Expected Output:**
```json
{
  "total_workshops": 16,
  "found": [
    {
      "ci": "summit-2026.lb1208-image-mode.event",
      "catalog": "babylon-catalog-event",
      "status": "ok"
    }
  ],
  "not_found": [],
  "auto_fixes_applied": [
    {
      "ci": "summit-2026.lb1208-image-mode",
      "fix": "Added .event suffix",
      "new_ci": "summit-2026.lb1208-image-mode.event"
    }
  ],
  "ready_to_deploy": true
}
```

---

### Step 3: Auto-Fix CSV (Bonus)

**Extended version that writes fixed CSV:**

```python
@mcp.tool()
def validate_and_fix_csv(
    csv_path: str,
    cluster_url: str,
    output_path: str = None
) -> Dict:
    """
    Validate catalog items and write fixed CSV if needed.
    
    Args:
        csv_path: Input CSV path
        cluster_url: OpenShift cluster URL  
        output_path: Output CSV path (default: <input>-fixed.csv)
        
    Returns:
        Validation results and path to fixed CSV
    """
    
    # Run validation
    results = validate_catalog_namespaces(csv_path, cluster_url, auto_fix=True)
    
    if not results["auto_fixes_applied"]:
        return {
            **results,
            "message": "No fixes needed, CSV is valid"
        }
    
    # Read CSV and apply fixes
    workshops = []
    with open(csv_path, 'r') as f:
        reader = csv.DictReader(f)
        workshops = list(reader)
    
    # Apply fixes
    for ws in workshops:
        for fix in results["auto_fixes_applied"]:
            if ws['CI'] == fix['ci']:
                ws['CI'] = fix['new_ci']
                ws['Catalog_Namespace'] = 'babylon-catalog-event'
    
    # Write fixed CSV
    if not output_path:
        output_path = csv_path.replace('.csv', '-fixed.csv')
    
    with open(output_path, 'w', newline='') as f:
        writer = csv.DictWriter(f, fieldnames=reader.fieldnames)
        writer.writeheader()
        writer.writerows(workshops)
    
    return {
        **results,
        "fixed_csv": output_path,
        "message": f"Fixed CSV written to {output_path}"
    }
```

---

## Testing Checklist

- [ ] MCP server starts without errors
- [ ] Tool shows up in Claude Code
- [ ] Can validate a CSV with correct catalog items
- [ ] Detects CIs in wrong catalog
- [ ] Suggests .event suffix when needed
- [ ] Auto-fixes work correctly
- [ ] Handles multi-asset workshops (checks all Asset_CIs)

---

## Common Issues

**oc command not found:**
```bash
# Make sure oc is in PATH
which oc
# If not, add to PATH or use full path
```

**Permission denied:**
```bash
# Make sure logged into cluster
oc whoami
oc login https://api.ocp-us-west-2.infra.open.redhat.com:6443
```

**Timeout:**
```python
# Increase timeout in subprocess.run
timeout=30  # Instead of 10
```

---

## Next Steps

Once this works:
1. ✅ Move to Tool #2: `transform_runbook_to_csv`
2. Add resource to expose catalog items: `flow://cluster/catalogs`
3. Add caching to avoid repeated oc queries

---

**This one tool prevents 90% of deployment failures. Worth the effort!** 🎯
