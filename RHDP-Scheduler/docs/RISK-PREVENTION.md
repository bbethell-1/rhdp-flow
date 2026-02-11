# RHDP-Flow Risk Prevention Features

Safeguards built into the RHDP-Flow UI to prevent user errors during workshop scheduling, deployment, and lifecycle management.

---

## Implemented

### 1. Date Validation Warnings (HIGH)

**Risk:** Deploying workshops with past dates, unparseable dates, or auto-destroy before auto-stop causes incorrect resource lifecycles.

**Safeguard:** After CSV upload, the schedule preview automatically validates all date fields and displays inline warnings:

- **Past provisioning dates** flagged with specific date shown
- **Auto-destroy before auto-stop** flagged as contradictory lifecycle
- **Unparseable dates** flagged with the raw string so user can correct the CSV
- **Missing dates** flagged (provisioning, auto-stop, auto-destroy)
- Affected rows highlighted with a yellow left border in the preview table

### 2. Multi-Asset Password Warning (HIGH)

**Risk:** Multi-asset workshops require per-asset passwords. Deploying without uploading a password file causes silent failures.

**Safeguard:** When multi-asset schedules are detected and no password file has been uploaded, a prominent warning banner appears above the schedule table:

> "Multi-asset workshop(s) detected but no password file uploaded. Each asset CI may need its own password."

### 3. Enriched Live Deploy Confirmation (HIGH)

**Risk:** User clicks Deploy without realizing the scope (e.g., 50 workshops instead of 5) or that unresolved warnings exist.

**Safeguard:** The live deployment confirmation modal now includes:

- Full list of schedules to deploy (CI name, CI, namespace, instance/user counts, multi-asset flag)
- Warning count if any validation warnings are unresolved
- Scrollable summary for large schedule sets

### 4. Confirmation Modals for Destructive Actions (HIGH)

**Risk:** Accidental live deployments or session clears destroy work.

**Safeguard:**

- **Live deploy:** Confirmation modal required when dry-run mode is off (does not appear for dry-runs)
- **Clear session:** Confirmation modal warns that all schedules, results, and logs will be archived
- **Lock workshops:** Confirmation modal warns this immediately shuts down workshops and cannot be undone

### 5. Loading States on Operations (MEDIUM)

**Risk:** User double-clicks operations buttons, triggering duplicate requests.

**Safeguard:** All operation buttons (Lock, Extend Stop, Extend Destroy, Scale) show loading spinners and are disabled while the request is in-flight.

---

## Planned

### 6. Scale to Zero Warning (MEDIUM)

**Risk:** Scaling to 0 instances destroys all workshop resources. The number input currently allows 0 without confirmation.

**Fix:** Add confirmation modal when target count is 0, warning that this will remove all instances.

### 7. Lock Scope Visibility (MEDIUM)

**Risk:** User locks "All Catalog Items" when they intended to lock a single CI, because the confirmation modal does not show how many workshops will be affected.

**Fix:** Display the CI filter value and affected workshop count in the lock confirmation modal.

### 8. Dry-Run Mode Visual Distinction (MEDIUM)

**Risk:** User forgets they toggled off dry-run mode and accidentally deploys live.

**Fix:** Add a persistent warning banner or color accent when dry-run is disabled, making live mode visually distinct.

### 9. CSV Row Skip Reporting (MEDIUM)

**Risk:** Some CSV rows fail to parse (bad values in Users, Instances, Concurrency) and are silently dropped. User sees "Loaded 7 schedules" but uploaded 10 rows.

**Fix:** Return skipped row count and reasons from backend; display in upload summary.

### 10. Blank Field Visual Flags (MEDIUM)

**Risk:** Rows with missing passwords, blank activity/purpose fields, or empty optional fields are not visually distinguished.

**Fix:** Add warning icons or color coding on rows with incomplete data in the schedule preview.

### 11. Extend Operations Preview (LOW)

**Risk:** User extends stop/destroy time without knowing the current values, leading to unintended schedules.

**Fix:** Show "Current: X -> New: Y" preview before confirming extend operations.

### 12. Operations Audit Trail (LOW)

**Risk:** No record of lock/extend/scale operations after page refresh.

**Fix:** Persist operations history to session storage or backend.

### 13. QA Type Descriptions (LOW)

**Risk:** User runs wrong QA check because QA1 vs QA2 purpose is unclear.

**Fix:** Add tooltip descriptions to QA type options.

---

*Last updated: 2026-02-10*
