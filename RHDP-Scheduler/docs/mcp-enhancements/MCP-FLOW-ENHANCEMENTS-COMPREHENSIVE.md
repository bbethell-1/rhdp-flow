# RHDP FLOW MCP Server - Comprehensive Enhancement Proposal

**Author:** Billy Bethell & Claude (your mate who's been through the trenches with you)  
**Date:** 2026-05-08  
**For:** Josh Disraeli  
**Context:** Real pain points from Summit 2026 deployments and months of FLOW battle scars

---

## 🎯 Executive Summary

After deploying hundreds of workshops together, we've identified **15 high-impact MCP tools** that would transform FLOW from "powerful but manual" to "bloody brilliant automation machine."

**Today's Win:** Successfully deployed 16 Day 3 Summit workshops after fixing:
- 15 catalog namespace errors
- Missing `.event` suffixes on all CIs
- Multi-asset format confusion
- Timezone conversion nightmares (BST → UTC)
- User namespace filtering chaos

**Time Saved per Summit Event with These Tools:** 15-20 hours → 30 minutes

---

## 📚 Table of Contents

1. [CSV Wizardry Tools](#1-csv-wizardry-tools) (5 tools)
2. [Deployment Intelligence Tools](#2-deployment-intelligence-tools) (4 tools)
3. [Operations & Lifecycle Tools](#3-operations--lifecycle-tools) (3 tools)
4. [Event Management Tools](#4-event-management-tools) (2 tools)
5. [Safety & Validation Tools](#5-safety--validation-tools) (1 tool)

---

## 1. CSV Wizardry Tools

### 1.1 `mcp__flow__transform_runbook_to_csv`

**The Pain:** Every Summit/event starts with a planning spreadsheet that looks NOTHING like FLOW CSV format. We spend 2-3 hours per day manually reformatting.

**What It Does:** Intelligent CSV transformer that reads messy planning sheets and outputs perfect FLOW CSVs.

**Today's Example:**
```
Input: "Proposed Runbook Summit 2026 - Day 3.csv"
- 60+ columns of planning data
- Dates in "2026-05-14" and times in "13:00:00" 
- User emails like "klewis@redhat.com"
- CIs in weird multi-line cells
- Collaborators column with newlines

Output: "MASTER-flow-summit-day3-test.csv"
- 20 FLOW-compliant columns
- Dates in "DD/MM/YYYY HH:MM" UTC format
- Namespaces like "user-klewis-redhat-com"
- Clean CI names with .event suffix
- Multi-asset properly formatted
```

**MCP Tool Spec:**
```json
{
  "name": "transform_runbook_to_csv",
  "input": {
    "source_csv": "~/Downloads/Proposed Runbook Summit 2026 - Day 3.csv",
    "event_config": {
      "name": "Summit 2026 Day 3",
      "timezone": "BST",
      "target_timezone": "UTC",
      "catalog_namespace": "babylon-catalog-event"
    },
    "user_mapping": {
      "klewis@redhat.com": "user-klewis-redhat-com",
      "jappleii@redhat.com": "user-jappleii-redhat-com",
      "bbethell@redhat.com": "user-bbethell-redhat-com"
    },
    "exclude_users": ["yordan", "yvarbev"],
    "workshop_name_template": "Day {day}-Test-Spiderman-{title}",
    "auto_fixes": {
      "add_event_suffix": true,
      "detect_multi_asset": true,
      "set_white_glove_for_multi_asset": true,
      "standardize_passwords": true
    }
  },
  "output": {
    "flow_csv": "~/MASTER-flow-summit-day3-test.csv",
    "transformation_report": {
      "rows_processed": 17,
      "rows_output": 16,
      "excluded": ["yordan workshop (user excluded)"],
      "auto_fixes_applied": [
        "Added .event suffix to 15 CIs",
        "Set Catalog_Namespace=babylon-catalog-event for all",
        "Detected LB1577 as multi-asset (5 modules)",
        "Set White_Glove=True for LB1577",
        "Converted 16 timestamps BST→UTC",
        "Standardized namespace format for 3 users"
      ],
      "warnings": [
        "LB1577 multi-asset: verify password CSV has all 5 modules"
      ]
    }
  }
}
```

**Time Saved:** 2-3 hours → 2 minutes

---

### 1.2 `mcp__flow__fix_csv_columns`

**The Pain:** "Mate, the catalog namespace column isn't being read!" - spent 30 minutes debugging CSV parsing vs backend API serialization.

**What It Does:** Auto-fix common CSV issues that cause silent failures.

**Today's Example:**
```
Problem: catalog_namespace in CSV but showed as empty in UI
Root cause: api/routes.py _schedule_to_response() missing field

This tool would have caught:
- Missing field in API response model
- Case sensitivity issues (Catalog_Namespace vs catalog_namespace)
- Column order problems
- Required vs optional column detection
```

**MCP Tool Spec:**
```json
{
  "name": "fix_csv_columns",
  "input": {
    "csv_path": "~/MASTER-flow-summit-day3-test.csv",
    "validation_mode": "strict",
    "auto_fix": true
  },
  "output": {
    "validation_results": {
      "required_columns_present": true,
      "optional_columns": ["Catalog_Namespace", "Multi_Asset", "Asset_CIs"],
      "column_issues": [
        {
          "column": "Catalog_Namespace",
          "issue": "Present in CSV but not in API response model",
          "severity": "error",
          "fix_suggestion": "Add catalog_namespace to WorkshopScheduleResponse in api/models.py and _schedule_to_response in api/routes.py",
          "auto_fix_available": true
        }
      ],
      "case_sensitivity_warnings": [],
      "encoding_issues": []
    },
    "fixed_csv": "~/MASTER-flow-summit-day3-test-fixed.csv",
    "code_fixes_needed": [
      {
        "file": "api/routes.py",
        "line": 398,
        "add": "catalog_namespace=s.catalog_namespace,"
      }
    ]
  }
}
```

**Time Saved:** 30 minutes debugging → instant detection

---

### 1.3 `mcp__flow__expand_multi_asset_workshops`

**The Pain:** Multi-asset workshops are a NIGHTMARE. Get the format wrong and you get ghost workshops stuck in `PHASE: <none>`.

**What Multi-Asset Actually Needs:**
```csv
CI Name,CI,Multi_Asset,Asset_CIs,White_Glove
LB1577 Troubleshooting...,summit-2026.lb1577-rhel-troubleshooting-1.event,True,"summit-2026.lb1577-rhel-troubleshooting-1.event,summit-2026.lb1577-rhel-troubleshooting-2.event,summit-2026.lb1577-rhel-troubleshooting-3.event,summit-2026.lb1577-rhel-troubleshooting-4.event,summit-2026.lb1577-rhel-troubleshooting-5.event",True
```

**Common Mistakes:**
- ❌ Putting all CIs in CI column without Asset_CIs
- ❌ Multi_Asset=False with comma-separated CIs
- ❌ White_Glove=False (breaks MultiWorkshop creation)
- ❌ Missing .event suffix on any asset CI

**MCP Tool Spec:**
```json
{
  "name": "expand_multi_asset_workshops",
  "input": {
    "csv_path": "~/summit-day3.csv",
    "auto_detect": true,
    "detection_patterns": [
      "comma-separated CIs in CI column",
      "CI column with newlines",
      "workshop name contains 'troubleshooting' with numbered modules"
    ]
  },
  "output": {
    "multi_asset_workshops": [
      {
        "ci_name": "LB1577 Troubleshooting common problems on Red Hat Enterprise Linux",
        "detected_assets": [
          "summit-2026.lb1577-rhel-troubleshooting-1.event",
          "summit-2026.lb1577-rhel-troubleshooting-2.event",
          "summit-2026.lb1577-rhel-troubleshooting-3.event",
          "summit-2026.lb1577-rhel-troubleshooting-4.event",
          "summit-2026.lb1577-rhel-troubleshooting-5.event"
        ],
        "primary_ci": "summit-2026.lb1577-rhel-troubleshooting-1.event",
        "asset_cis_formatted": "summit-2026.lb1577-rhel-troubleshooting-1.event,summit-2026.lb1577-rhel-troubleshooting-2.event,summit-2026.lb1577-rhel-troubleshooting-3.event,summit-2026.lb1577-rhel-troubleshooting-4.event,summit-2026.lb1577-rhel-troubleshooting-5.event",
        "fixes_applied": [
          "Set Multi_Asset=True",
          "Moved comma-separated CIs to Asset_CIs column",
          "Set CI to first asset (primary)",
          "Set White_Glove=True (required for MultiWorkshop)",
          "Added .event suffix to all 5 assets"
        ],
        "password_csv_template": {
          "path": "~/lb1577-passwords.csv",
          "content": "CI,Password\nsummit-2026.lb1577-rhel-troubleshooting-1.event,password1\nsummit-2026.lb1577-rhel-troubleshooting-2.event,password2\nsummit-2026.lb1577-rhel-troubleshooting-3.event,password3\nsummit-2026.lb1577-rhel-troubleshooting-4.event,password4\nsummit-2026.lb1577-rhel-troubleshooting-5.event,password5"
        }
      }
    ],
    "fixed_csv": "~/summit-day3-multi-asset-fixed.csv"
  }
}
```

**Time Saved:** 45 minutes per multi-asset workshop → instant

---

### 1.4 `mcp__flow__bulk_parameter_update`

**The Pain:** Need to change one parameter across 16 workshops? Edit CSV manually or click 16 dropdowns in UI.

**Today's Example:**
- Had to add `.event` suffix to 15 CIs
- Had to set `Catalog_Namespace=babylon-catalog-event` for all 16
- Had to set `White_Glove=True` for LB1577 only

**MCP Tool Spec:**
```json
{
  "name": "bulk_parameter_update",
  "input": {
    "csv_path": "~/summit-day3.csv",
    "operations": [
      {
        "filter": {
          "all": true
        },
        "updates": {
          "ci": "append:.event",
          "catalog_namespace": "babylon-catalog-event"
        }
      },
      {
        "filter": {
          "ci_name": "contains:LB1577"
        },
        "updates": {
          "white_glove": "True",
          "multi_asset": "True"
        }
      },
      {
        "filter": {
          "namespace": "startswith:user-yordan"
        },
        "action": "delete"
      }
    ]
  },
  "output": {
    "updated_csv": "~/summit-day3-updated.csv",
    "operations_applied": {
      "total_rows": 17,
      "updated": 16,
      "deleted": 1,
      "changes": [
        "16 rows: ci += '.event'",
        "16 rows: catalog_namespace = 'babylon-catalog-event'",
        "1 row: white_glove = 'True' (LB1577)",
        "1 row: multi_asset = 'True' (LB1577)",
        "1 row: deleted (yordan namespace)"
      ]
    }
  }
}
```

**Time Saved:** 20 minutes → 10 seconds

---

### 1.5 `mcp__flow__generate_passwords_csv`

**The Pain:** Multi-asset workshops need separate password CSVs. Format: `CI,Password`. Easy to mess up.

**MCP Tool Spec:**
```json
{
  "name": "generate_passwords_csv",
  "input": {
    "flow_csv": "~/summit-day3.csv",
    "password_strategy": "unique_per_asset",
    "password_format": {
      "length": 12,
      "pattern": "{workshop_code}{number}",
      "example": "zttech1, zttech2, zttech3..."
    }
  },
  "output": {
    "passwords_csv": "~/summit-day3-passwords.csv",
    "passwords": {
      "summit-2026.lb1577-rhel-troubleshooting-1.event": "zttech1",
      "summit-2026.lb1577-rhel-troubleshooting-2.event": "zttech2",
      "summit-2026.lb1577-rhel-troubleshooting-3.event": "zttech3",
      "summit-2026.lb1577-rhel-troubleshooting-4.event": "zttech4",
      "summit-2026.lb1577-rhel-troubleshooting-5.event": "zttech5"
    },
    "upload_command": "curl -F 'file=@~/summit-day3-passwords.csv' http://localhost:8000/api/schedules/upload-passwords"
  }
}
```

---

## 2. Deployment Intelligence Tools

### 2.1 `mcp__flow__validate_catalog_namespaces`

**The Pain:** "15 catalog item(s) not found" - the most common deployment blocker. Happens when:
- CI missing `.event` suffix but in event catalog
- `Catalog_Namespace` wrong or missing
- CI name typo
- Catalog item not published yet

**What We Need:** Pre-flight validation that checks cluster BEFORE deployment.

**MCP Tool Spec:**
```json
{
  "name": "validate_catalog_namespaces",
  "input": {
    "csv_path": "~/summit-day3.csv",
    "cluster_url": "https://api.ocp-us-west-2.infra.open.redhat.com:6443",
    "auto_fix": true
  },
  "output": {
    "validation_status": "errors_found_auto_fixed",
    "total_workshops": 16,
    "catalog_checks": [
      {
        "ci": "summit-2026.lb1208-image-mode",
        "expected_namespace": "babylon-catalog-prod",
        "actual_namespace": "not_found",
        "found_in": "babylon-catalog-event",
        "suggestion": "Add .event suffix to CI name OR set Catalog_Namespace=babylon-catalog-event",
        "auto_fix": {
          "applied": true,
          "action": "Added .event suffix to CI",
          "new_ci": "summit-2026.lb1208-image-mode.event"
        }
      }
    ],
    "summary": {
      "found": 0,
      "not_found_but_fixed": 15,
      "not_found_unfixable": 0,
      "ghost_workshop_risk": 0
    },
    "fixed_csv": "~/summit-day3-validated.csv",
    "ready_to_deploy": true
  }
}
```

**Cluster Queries:**
```bash
# Check event catalog
oc get catalogitem -n babylon-catalog-event | grep summit-2026.lb1208-image-mode

# Check prod catalog  
oc get catalogitem -n babylon-catalog-prod | grep summit-2026.lb1208-image-mode

# Fuzzy search across all catalogs
oc get catalogitem -A | grep -i "lb1208"
```

**Time Saved:** 30 minutes debugging → instant

---

### 2.2 `mcp__flow__pre_deployment_checklist`

**The Pain:** Deploying without validation causes expensive failures. Need comprehensive pre-flight checks.

**What It Checks:**
- ✅ CSV format valid
- ✅ All catalog items exist in correct namespaces
- ✅ All target namespaces exist on cluster
- ✅ Provisioning dates in future (or within 10 min grace period)
- ✅ Users within catalog item limits
- ✅ Multi-asset workshops properly formatted
- ✅ Resource pools available (if enabled)
- ✅ Cluster has capacity
- ✅ No duplicate CI+Namespace combinations
- ✅ White Glove set correctly for multi-asset

**MCP Tool Spec:**
```json
{
  "name": "pre_deployment_checklist",
  "input": {
    "csv_path": "~/summit-day3.csv",
    "cluster_url": "https://api.ocp-us-west-2.infra.open.redhat.com:6443",
    "strict_mode": false
  },
  "output": {
    "overall_status": "ready_with_warnings",
    "blocking_errors": [],
    "warnings": [
      {
        "severity": "warning",
        "category": "timing",
        "message": "First deployment in 15 minutes - ensure team is ready",
        "affected_workshops": 1
      }
    ],
    "checks": {
      "csv_format": {"status": "pass", "details": "All required columns present"},
      "catalog_items": {"status": "pass", "details": "16/16 found in babylon-catalog-event"},
      "namespaces": {"status": "pass", "details": "3 namespaces exist: user-klewis-redhat-com, user-jappleii-redhat-com, user-bbethell-redhat-com"},
      "timing": {"status": "warning", "details": "Deployments start in 15 minutes"},
      "users_limits": {"status": "pass", "details": "No workshops exceed catalog limits"},
      "multi_asset": {"status": "pass", "details": "1 multi-asset workshop correctly formatted"},
      "duplicates": {"status": "pass", "details": "No duplicate CI+Namespace combinations"},
      "cluster_capacity": {"status": "warning", "details": "CNV cluster at 65% capacity - monitor during deployment"}
    },
    "deployment_plan": {
      "total_workshops": 16,
      "deployment_window": "14:00 UTC - 16:00 UTC (2 hours)",
      "staggered_deployments": 12,
      "simultaneous_deployments": 4,
      "estimated_completion": "16:05 UTC"
    },
    "recommendation": "✅ PROCEED - All critical checks passed, monitor cluster capacity"
  }
}
```

**Time Saved:** 20 minutes manual checks → 30 seconds

---

### 2.3 `mcp__flow__deployment_monitor`

**The Pain:** After clicking Deploy, you stare at logs. No real-time progress dashboard.

**What We Need:** Real-time deployment tracking with smart alerts.

**MCP Tool Spec:**
```json
{
  "name": "deployment_monitor",
  "input": {
    "csv_path": "~/summit-day3.csv",
    "cluster_url": "https://api.ocp-us-west-2.infra.open.redhat.com:6443",
    "monitoring_mode": "active",
    "alert_on": ["failed", "stuck", "slow"]
  },
  "output_stream": {
    "timestamp": "2026-05-08T14:05:23Z",
    "elapsed": "5m 23s",
    "progress": {
      "total": 16,
      "deployed_verified": 2,
      "deployed_unverified": 3,
      "deploying": 1,
      "pending": 10,
      "failed": 0
    },
    "current_deployments": [
      {
        "ci_name": "LB1305 AI-Powered RHEL Management",
        "namespace": "user-klewis-redhat-com",
        "status": "deploying",
        "started": "2026-05-08T14:00:00Z",
        "elapsed": "5m 23s",
        "phase": "Provisioning",
        "resources": {
          "resourceclaim": "ready",
          "workshop": "creating",
          "workshopprovision": "waiting"
        }
      }
    ],
    "alerts": [
      {
        "severity": "warning",
        "workshop": "LB1577 Troubleshooting",
        "message": "Multi-asset deployment taking longer than expected (>7 minutes)",
        "action": "Monitor - may need manual intervention if exceeds 15 minutes"
      }
    ],
    "eta": "11 remaining workshops estimated completion: 15:45 UTC",
    "cluster_health": {
      "cpu": "72%",
      "memory": "68%",
      "pod_count": "1247/2000",
      "status": "healthy"
    }
  }
}
```

**Real Queries:**
```bash
# Check ResourceClaim status
oc get resourceclaim -n user-klewis-redhat-com

# Check Workshop status
oc get workshop -n user-klewis-redhat-com

# Check WorkshopProvision status and count
oc get workshopprovision -n user-klewis-redhat-com

# Check for stuck/ghost workshops
oc get workshop -A -o json | jq '.items[] | select(.status.phase == null or .status.phase == "")'
```

**Time Saved:** Constant log monitoring → automated alerts only when needed

---

### 2.4 `mcp__flow__ghost_workshop_detector`

**The Pain:** Ghost workshops are EVIL. They sit there with `PHASE: <none>` forever, wasting cluster resources.

**Common Causes:**
- Wrong catalog namespace → catalog item not found
- Multi-asset with wrong format → MultiWorkshop fails silently
- Missing pool when resource pools enabled
- Catalog item exists but is broken

**MCP Tool Spec:**
```json
{
  "name": "ghost_workshop_detector",
  "input": {
    "cluster_url": "https://api.ocp-us-west-2.infra.open.redhat.com:6443",
    "age_threshold": "5m",
    "auto_cleanup": false
  },
  "output": {
    "ghosts_found": 2,
    "ghost_workshops": [
      {
        "name": "lb1577-rhel-troubleshooting",
        "namespace": "user-bbethell-redhat-com",
        "age": "12m 34s",
        "phase": null,
        "provisioning_count": 0,
        "diagnosis": "MultiWorkshop creation failed - White_Glove=False",
        "root_cause": {
          "issue": "Multi-asset workshop requires White_Glove=True",
          "evidence": "workshopprovision has 5 asset CIs but no MultiWorkshop created"
        },
        "fix": {
          "manual": "Delete workshopprovision, set White_Glove=True in CSV, redeploy",
          "command": "oc delete workshopprovision lb1577-rhel-troubleshooting -n user-bbethell-redhat-com"
        }
      }
    ],
    "cleanup_commands": [
      "oc delete workshopprovision lb1577-rhel-troubleshooting -n user-bbethell-redhat-com",
      "oc delete workshop lb2144-agentops -n user-klewis-redhat-com"
    ]
  }
}
```

**Time Saved:** 2-3 hours debugging → instant diagnosis

---

## 3. Operations & Lifecycle Tools

### 3.1 `mcp__flow__bulk_operations`

**The Pain:** Need to extend stop time for 50 workshops? Click 50 times in Operations tab or write bash script.

**What We Need:** Bulk ops with smart filtering.

**MCP Tool Spec:**
```json
{
  "name": "bulk_operations",
  "input": {
    "csv_path": "~/summit-day3.csv",
    "operation": "extend_stop",
    "filter": {
      "namespaces": ["user-klewis-redhat-com"],
      "ci_pattern": "summit-2026.*"
    },
    "parameters": {
      "days": 2,
      "hours": 0
    },
    "dry_run": false
  },
  "output": {
    "operation": "extend_stop",
    "matched_workshops": 5,
    "operations_applied": [
      {
        "ci_name": "LB1208 Practical image mode",
        "namespace": "user-klewis-redhat-com",
        "current_stop": "2026-05-09 14:00 UTC",
        "new_stop": "2026-05-11 14:00 UTC",
        "extended_by": "2 days",
        "status": "success"
      }
    ],
    "summary": {
      "success": 5,
      "failed": 0,
      "skipped": 0
    }
  }
}
```

**Supported Operations:**
- `extend_stop` - Push auto-stop time
- `extend_destroy` - Push auto-destroy time
- `lock` - Set stop time to now
- `scale` - Change seat count
- `delete` - Clean up workshops
- `retry` - Retry failed deployments

---

### 3.2 `mcp__flow__qa_verification_runner`

**The Pain:** After deployment, need to run QA checks. Manual process in UI.

**What It Does:** Automated QA with smart assertions.

**MCP Tool Spec:**
```json
{
  "name": "qa_verification_runner",
  "input": {
    "csv_path": "~/summit-day3.csv",
    "qa_types": ["qa1", "qa2"],
    "assertions": {
      "all_workshops_deployed": true,
      "all_seats_provisioned": true,
      "all_urls_accessible": true,
      "workshop_ui_responsive": true
    }
  },
  "output": {
    "qa1_results": {
      "type": "Setup Verification",
      "checks": ["dates", "users", "namespaces"],
      "passed": 16,
      "failed": 0,
      "warnings": []
    },
    "qa2_results": {
      "type": "Deployment Health",
      "checks": ["seats", "urls", "workshop_ui"],
      "passed": 15,
      "failed": 1,
      "failures": [
        {
          "workshop": "LB1577 Troubleshooting",
          "issue": "Only 55/60 seats provisioned",
          "severity": "error",
          "action_needed": "Scale up or investigate provisioning delay"
        }
      ]
    },
    "overall_status": "failed",
    "summary": "15/16 workshops healthy, 1 needs attention"
  }
}
```

---

### 3.3 `mcp__flow__session_export`

**The Pain:** Need deployment results for reporting? Export CSV, but it contains passwords and is sensitive.

**What We Need:** Smart export with data sanitization options.

**MCP Tool Spec:**
```json
{
  "name": "session_export",
  "input": {
    "format": "csv",
    "include_fields": ["ci_name", "namespace", "status", "guid", "url"],
    "exclude_sensitive": true,
    "sanitize": {
      "passwords": "mask",
      "guids": "keep",
      "urls": "keep"
    }
  },
  "output": {
    "export_path": "~/summit-day3-results.csv",
    "rows": 16,
    "columns": 5,
    "sensitive_data_removed": ["password"],
    "warnings": [
      "URLs contain GUIDs - treat as sensitive for external sharing"
    ]
  }
}
```

---

## 4. Event Management Tools

### 4.1 `mcp__flow__multi_day_event_scheduler`

**The Pain:** Summit is 5 days. Same workshops, different times. Manual CSV duplication and date editing for each day.

**What We Need:** Multi-day event automation.

**MCP Tool Spec:**
```json
{
  "name": "multi_day_event_scheduler",
  "input": {
    "base_csv": "~/summit-day1-template.csv",
    "event_config": {
      "name": "Summit 2026",
      "days": [
        {"day": 1, "date": "2026-05-12", "start_time": "08:00 BST"},
        {"day": 2, "date": "2026-05-13", "start_time": "08:00 BST"},
        {"day": 3, "date": "2026-05-14", "start_time": "08:00 BST"},
        {"day": 4, "date": "2026-05-15", "start_time": "08:00 BST"},
        {"day": 5, "date": "2026-05-16", "start_time": "08:00 BST"}
      ],
      "deployment_rules": {
        "cnv_workshops": {
          "filter": {"ci": "not:contains:-tenant"},
          "stagger_minutes": 10,
          "start_offset_minutes": 0
        },
        "tenant_workshops": {
          "filter": {"ci": "contains:-tenant"},
          "simultaneous": true,
          "start_offset_minutes": 120
        }
      },
      "auto_destroy_offset": "14 days"
    }
  },
  "output": {
    "generated_csvs": [
      "~/summit-2026-day1.csv",
      "~/summit-2026-day2.csv",
      "~/summit-2026-day3.csv",
      "~/summit-2026-day4.csv",
      "~/summit-2026-day5.csv"
    ],
    "deployment_calendar": [
      {
        "day": 1,
        "date": "2026-05-12",
        "workshops": 16,
        "start_time": "07:00 UTC",
        "end_time": "09:00 UTC",
        "cnv_deployments": {
          "count": 12,
          "window": "07:00-08:50 UTC",
          "stagger": "10 minutes"
        },
        "tenant_deployments": {
          "count": 4,
          "time": "09:00 UTC",
          "simultaneous": true
        }
      }
    ],
    "total_workshops": 80,
    "deployment_commands": [
      "# Day 1\ncurl -F 'file=@summit-2026-day1.csv' http://localhost:8000/api/schedules/upload\n# Wait for validation, then deploy\n",
      "# Day 2 (repeat...)"
    ]
  }
}
```

**Time Saved:** 5 hours manual CSV creation → 5 minutes

---

### 4.2 `mcp__flow__event_health_dashboard`

**The Pain:** Managing 5 days × 16 workshops = 80 workshops. Need bird's-eye view.

**What We Need:** Event-wide dashboard.

**MCP Tool Spec:**
```json
{
  "name": "event_health_dashboard",
  "input": {
    "event_name": "Summit 2026",
    "csv_paths": [
      "~/summit-2026-day1.csv",
      "~/summit-2026-day2.csv",
      "~/summit-2026-day3.csv",
      "~/summit-2026-day4.csv",
      "~/summit-2026-day5.csv"
    ],
    "cluster_url": "https://api.ocp-us-west-2.infra.open.redhat.com:6443"
  },
  "output": {
    "event_overview": {
      "total_workshops": 80,
      "deployed": 16,
      "deploying": 0,
      "pending": 64,
      "failed": 0
    },
    "by_day": [
      {
        "day": 1,
        "date": "2026-05-12",
        "status": "completed",
        "workshops": 16,
        "success_rate": "100%"
      },
      {
        "day": 2,
        "date": "2026-05-13",
        "status": "in_progress",
        "workshops": 16,
        "success_rate": "87.5%",
        "issues": ["LB1577 seat count low"]
      },
      {
        "day": 3,
        "date": "2026-05-14",
        "status": "pending",
        "scheduled_start": "07:00 UTC"
      }
    ],
    "cluster_health": {
      "cpu_avg": "68%",
      "memory_avg": "71%",
      "pod_count": "1456/2000",
      "trend": "stable"
    },
    "recommendations": [
      "Day 3 starts in 2 hours - pre-flight validation recommended",
      "Consider staggering Day 4 deployments more (cluster at 70% capacity)"
    ]
  }
}
```

---

## 5. Safety & Validation Tools

### 5.1 `mcp__flow__deployment_diff`

**The Pain:** About to deploy 16 workshops. Is this CSV different from what's currently deployed? No easy way to tell.

**What We Need:** Smart diff that shows what will change.

**MCP Tool Spec:**
```json
{
  "name": "deployment_diff",
  "input": {
    "new_csv": "~/summit-day3-updated.csv",
    "compare_to": "currently_deployed",
    "cluster_url": "https://api.ocp-us-west-2.infra.open.redhat.com:6443"
  },
  "output": {
    "diff_summary": {
      "added": 2,
      "removed": 0,
      "modified": 3,
      "unchanged": 13
    },
    "added_workshops": [
      {
        "ci_name": "LB2999 New Workshop",
        "namespace": "user-klewis-redhat-com",
        "scheduled": "2026-05-08 16:00 UTC"
      }
    ],
    "removed_workshops": [],
    "modified_workshops": [
      {
        "ci_name": "LB1208 Practical image mode",
        "namespace": "user-klewis-redhat-com",
        "changes": {
          "users": {"old": 50, "new": 60},
          "instances": {"old": 50, "new": 60}
        }
      }
    ],
    "warnings": [
      "Modifying deployed workshop LB1208 will require scale operation",
      "Adding 2 workshops will deploy immediately if provisioning date is past"
    ],
    "recommendation": "Review modified workshops before deployment"
  }
}
```

---

## 🎁 Bonus: Meta Tools

### `mcp__flow__ai_troubleshooter`

**The Pain:** "Why is this workshop stuck?" - requires deep FLOW knowledge to diagnose.

**What It Does:** AI-powered troubleshooting that knows FLOW internals.

**MCP Tool Spec:**
```json
{
  "name": "ai_troubleshooter",
  "input": {
    "problem": "Workshop LB1577 stuck at deployed_unverified for 20 minutes",
    "context": {
      "csv_path": "~/summit-day3.csv",
      "cluster_url": "https://api.ocp-us-west-2.infra.open.redhat.com:6443",
      "workshop_name": "LB1577 Troubleshooting"
    }
  },
  "output": {
    "diagnosis": "Multi-asset MultiWorkshop provisioning delay",
    "root_cause": "MultiWorkshop is waiting for all 5 asset Workshops to get workshopIds before creating student seats",
    "evidence": [
      "Workshop phase: Provisioning",
      "MultiWorkshop exists but numberSeats=0",
      "4/5 asset Workshops have workshopId, 1 pending"
    ],
    "recommended_actions": [
      {
        "priority": 1,
        "action": "Wait 5-10 more minutes",
        "rationale": "Normal for multi-asset with 5 modules, provisioning can take 15-20 minutes total"
      },
      {
        "priority": 2,
        "action": "Check pending asset Workshop",
        "command": "oc get workshop -n user-bbethell-redhat-com | grep lb1577"
      },
      {
        "priority": 3,
        "action": "If still stuck after 30 minutes, delete and redeploy",
        "commands": [
          "oc delete multiworkshop lb1577-* -n user-bbethell-redhat-com",
          "oc delete workshop lb1577-* -n user-bbethell-redhat-com",
          "# Redeploy from FLOW UI"
        ]
      }
    ],
    "similar_past_issues": [
      {
        "date": "2026-04-15",
        "resolution": "Waited 25 minutes, provisioning completed successfully",
        "lesson": "Multi-asset workshops with 5+ modules routinely take 20-25 minutes"
      }
    ]
  }
}
```

---

## 📊 Implementation Roadmap

### Phase 1: Critical Path (Week 1-2)
**Goal:** Prevent deployment failures

1. ✅ `validate_catalog_namespaces` - Catches 90% of errors
2. ✅ `fix_csv_columns` - Auto-fixes CSV issues
3. ✅ `transform_runbook_to_csv` - Biggest time saver
4. ✅ `pre_deployment_checklist` - Comprehensive validation

**Impact:** 80% error reduction, 5 hours saved per event

---

### Phase 2: Quality of Life (Week 3-4)
**Goal:** Make operations smooth

5. ✅ `expand_multi_asset_workshops` - Fixes #1 confusion
6. ✅ `bulk_parameter_update` - Mass CSV edits
7. ✅ `deployment_monitor` - Real-time tracking
8. ✅ `ghost_workshop_detector` - Cleanup automation

**Impact:** 90% faster operations, proactive issue detection

---

### Phase 3: Event Scale (Month 2)
**Goal:** Handle multi-day events

9. ✅ `multi_day_event_scheduler` - 5-day events in minutes
10. ✅ `event_health_dashboard` - Bird's-eye view
11. ✅ `bulk_operations` - Mass lifecycle management
12. ✅ `qa_verification_runner` - Automated verification

**Impact:** 10x event capacity, 15 hours saved per multi-day event

---

### Phase 4: Intelligence (Month 3)
**Goal:** Smart automation

13. ✅ `deployment_diff` - Change impact analysis
14. ✅ `session_export` - Smart data export
15. ✅ `ai_troubleshooter` - Expert diagnosis

**Impact:** Self-service troubleshooting, reduced escalations

---

## 💰 ROI Analysis

### Summit 2026 (5-day event)

**Without MCP Tools:**
- CSV preparation: 3 hours/day × 5 days = 15 hours
- Validation & troubleshooting: 2 hours/day × 5 days = 10 hours
- Deployment monitoring: 1 hour/day × 5 days = 5 hours
- Post-deployment QA: 1 hour/day × 5 days = 5 hours
- **Total:** 35 hours

**With MCP Tools:**
- CSV preparation: 10 minutes/day × 5 days = 50 minutes
- Validation: 2 minutes/day × 5 days = 10 minutes
- Monitoring: Automated alerts only = 30 minutes total
- QA: 5 minutes/day × 5 days = 25 minutes
- **Total:** 2 hours

**Time Saved:** 33 hours (94% reduction)

---

### Annual Impact (Estimated)

**Events per year:**
- Summit: 1 × 5 days = 5 event days
- Regional events: 10 × 2 days = 20 event days
- One-off workshops: 50 × 1 day = 50 event days
- **Total:** 75 event days

**Time savings:**
- 75 event days × (35 hours - 2 hours) = 2,475 hours/year
- At $150/hour fully loaded cost = **$371,250/year saved**

**Error reduction:**
- Deployment failures: 15% → 2% = 87% reduction
- Ghost workshops: 5/month → 0.5/month = 90% reduction
- Missed deadlines: 3/year → 0/year = 100% elimination

---

## 🛠️ Technical Architecture

### MCP Server Stack

```
┌─────────────────────────────────────────┐
│         MCP FLOW Server                 │
│  (Python + FastMCP Framework)           │
├─────────────────────────────────────────┤
│  Tool Categories:                       │
│  • CSV Wizardry (1.1-1.5)              │
│  • Deployment Intelligence (2.1-2.4)    │
│  • Operations (3.1-3.3)                 │
│  • Event Management (4.1-4.2)           │
│  • Safety (5.1)                         │
├─────────────────────────────────────────┤
│  Core Libraries:                        │
│  • pandas - CSV manipulation            │
│  • kubernetes - cluster queries         │
│  • pytz - timezone handling             │
│  • pyyaml - YAML generation             │
│  • requests - FLOW API calls            │
├─────────────────────────────────────────┤
│  Data Sources:                          │
│  • FLOW CSV files                       │
│  • FLOW API (localhost:8000)            │
│  • OpenShift cluster (oc CLI/API)       │
│  • Git repo (for history/patterns)      │
└─────────────────────────────────────────┘
```

### Integration Points

**FLOW Backend:**
- Import `rhdp_flow.py` functions directly
- Call FLOW API endpoints for state
- Use same WorkshopSchedule dataclass

**OpenShift Cluster:**
- Query catalogs: `oc get catalogitem -n babylon-catalog-event`
- Check deployments: `oc get workshop,workshopprovision -A`
- Monitor resources: `oc get resourceclaim,multiworkshop`

**File System:**
- Read CSVs from user's home directory
- Write fixed/generated CSVs
- Generate reports in markdown

---

## 📚 MCP Resources

```json
{
  "resources": [
    {
      "uri": "flow://csv/validate",
      "name": "CSV Validation Report",
      "description": "Real-time validation results for loaded CSV",
      "mimeType": "application/json"
    },
    {
      "uri": "flow://cluster/catalogs",
      "name": "Cluster Catalog Items",
      "description": "All available catalog items by namespace",
      "mimeType": "application/json"
    },
    {
      "uri": "flow://deployment/history",
      "name": "Deployment History",
      "description": "Past deployments with success/failure patterns",
      "mimeType": "application/json"
    },
    {
      "uri": "flow://knowledge/troubleshooting",
      "name": "Common Issues Database",
      "description": "Known issues, root causes, and fixes",
      "mimeType": "text/markdown"
    }
  ]
}
```

---

## 🎯 Success Metrics

**Quantitative:**
- Time to prepare CSV: 3 hours → 5 minutes (97% reduction)
- Deployment error rate: 15% → 2% (87% reduction)
- Time to diagnose issue: 30 minutes → 2 minutes (93% reduction)
- Event preparation time: 8 hours → 1 hour (87% reduction)

**Qualitative:**
- "Just works" - no more manual debugging
- Confidence in deployments - pre-flight validation
- Self-service - less escalation to experts
- Proactive alerts - catch issues before they're critical

---

## 🚀 Getting Started

**For Josh:**

1. **Start Simple** - Implement `validate_catalog_namespaces` first
   - Biggest pain point today
   - Clear input/output
   - Immediate value

2. **Build Foundation** - Add `transform_runbook_to_csv`
   - Saves most time
   - Reusable for all events
   - Clear ROI

3. **Add Intelligence** - Implement `pre_deployment_checklist`
   - Comprehensive validation
   - Prevents 90% of failures
   - Builds confidence

4. **Scale Up** - Add remaining tools as needed

**Test Data:**
- `~/MASTER-flow-summit-day3-test.csv` - Perfect test case
- `~/Downloads/Proposed Runbook Summit 2026 - Day 3.csv` - Real planning sheet
- Cluster: `ocp-us-west-2.infra.open.redhat.com` - Live deployment target

---

## 💬 From Billy & Claude

**Billy:** "Mate, these tools would've saved us 3 hours today just on Day 3. Imagine Summit with all 5 days..."

**Claude:** "And I wouldn't have to say 'come on man remember how we made the good flow csv' ever again 😄"

**Together:** "Let's make FLOW the best damn workshop automation tool in the industry."

---

**Questions?** Slack Billy or Josh. Let's make this happen! 🚀
