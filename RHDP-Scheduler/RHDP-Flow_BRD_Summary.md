# RHDP-Flow: Business Requirements Summary

**Project:** RHDP Workshop Scheduling & Automation Tool | **Prepared for:** John and the White Glove Workshop Team | **Date:** February 2026

## Problem

White glove workshop deployments are entirely manual — coordinators create ResourceClaims, Workshops, and WorkshopProvisions one at a time via the UI or raw `oc` commands. A single 5-workshop event takes 30+ minutes, is error-prone (hand-typed JSON, UTC timestamps, namespace/CI IDs), and offers no bulk operations, automated verification, or audit trail. Multi-asset events (MultiWorkshop portals) compound these issues further.

## Proposed Solution

**RHDP-Flow** is a Python CLI tool that reads workshop schedules from a CSV spreadsheet and automates the full deployment lifecycle against the RHDP cluster.

### Core Capabilities

- **CSV-driven scheduling** — One row per workshop (catalog item, namespace, user count, dates, passwords, options)
- **Automated deployment** — Creates ResourceClaims, Workshops (with optional lab UI), and WorkshopProvisions with correct payloads, labels, and annotations
- **Multi-asset & multi-region** — Groups catalog items into MultiWorkshop portals; distributes users across AWS regions automatically
- **Multiple instances** — Deploy N copies of a workshop from a single CSV row
- **Dry-run mode** — Preview all payloads without creating resources

### Operational Controls

| Operation | Description |
|-----------|-------------|
| **Lock** | Immediately stop workshops by setting stop time to now |
| **Extend Stop/Destroy** | Push back auto-stop or auto-destroy times by days/hours |
| **Scale** | Adjust seat count to a target value |

### QA & Verification

- **QA1** — Compare CSV schedule against deployed state; flag mismatches in user counts, timestamps, or missing deployments
- **QA2** — Check health/readiness of all deployed workshops; report seat counts and provisioning state
- **Exports** — Student landing page URLs CSV and deployment results CSV (GUIDs, URLs, status, errors)

## Target Users

White Glove Workshop Coordinators (prepare CSV, run deployments), RHDP Operations (lock/extend/scale during live events), QA/Event Leads (verify deployments pre-handoff).

## Technical Approach

Python 3.7+, all cluster interaction via `oc` CLI (uses existing login session), CSV input/output (Excel/Sheets compatible), minimal dependencies (standard library core, optional `rich` for interactive wizard), dry-run safety on all operations, resources labeled for tracking.

## Success Criteria

Reduce deployment time from 30+ minutes to under 5, eliminate manual entry errors, enable single-command bulk operations, achieve 100% verification coverage against CSV, and full team adoption within one quarter.

## Scope

**In:** CSV-driven deployment, lifecycle operations (lock/extend/scale), QA/reporting, interactive CSV wizard.
**Out (future):** Google Sheets integration, automatic password rotation, cluster-state CSV generation, web UI.

## Risks & Mitigations

Cluster API changes mitigated by using standard `oc` commands and well-known resource types. Bad CSV input caught by validation and dry-run preview. CLI unfamiliarity addressed by interactive wizard and documentation.
