# RHDP-Flow: Business Requirements Summary

**Project:** RHDP Workshop Scheduling & Automation Tool | **Prepared for:** John and the White Glove Workshop Team | **Date:** February 2026 | **Status:** Implemented

## Problem

White glove workshop deployments are entirely manual — coordinators create ResourceClaims, Workshops, and WorkshopProvisions one at a time via the UI or raw `oc` commands. A single 5-workshop event takes 30+ minutes, is error-prone (hand-typed JSON, UTC timestamps, namespace/CI IDs), and offers no bulk operations, automated verification, or audit trail. Multi-asset events (MultiWorkshop portals) compound these issues further.

## Solution

**RHDP-Flow** is a Python CLI and React/PatternFly web tool that reads workshop schedules from a CSV spreadsheet and automates the full deployment lifecycle against the RHDP cluster.

### Core Capabilities

- **CSV-driven scheduling** — One row per workshop (catalog item, namespace, user count, dates, passwords, options)
- **Automated deployment** — Creates ResourceClaims, Workshops (with optional lab UI), and WorkshopProvisions with correct payloads, labels, and annotations
- **Multi-asset & multi-region** — Groups catalog items into MultiWorkshop portals; distributes users across AWS regions automatically
- **Multiple instances** — Deploy N copies of a workshop from a single CSV row
- **Dry-run mode** — Preview all payloads without creating resources

### Operational Controls

| Operation | Description |
|-----------|-------------|
| **Lock** | Toggle `demo.redhat.com/lock-enabled` label on workshops |
| **Extend Stop/Destroy** | Push back auto-stop or auto-destroy times by days/hours |
| **Scale** | Adjust seat count to a target value |
| **Update Passwords** | Detect changed passwords in CSV and patch existing workshops |

### Data Management

- **White Glove CSV Import** — Generate a schedule CSV from a deployed namespace (discovers Workshops via `oc`)
- **Master Sheet Sync** — Compare master vs local CSV by (CI, Namespace) key; report added/changed/unchanged rows

### QA & Verification

- **QA1** — Compare CSV schedule against deployed state; flag mismatches
- **QA2** — Check health/readiness of all deployed workshops; report seat counts
- **Exports** — Student landing page URLs CSV and deployment results CSV
- **CSV Validation** — Duplicate detection, CI/namespace format checks, user count reasonableness, date ordering
- **Namespace Validation** — Verify namespaces exist on cluster before deployment

### User Experience

- **Web UI** — React/PatternFly 6 interface for upload, configure, deploy, and review
- **Interactive CLI Wizard** — Guided wizard for generating schedule CSVs
- **Salesforce Tracking** — Multi-type (`opportunity`, `campaign`, `project`, `cdh`) chargeback annotations
- **Redirect Toggle** — Configurable `labUserInterface.redirect` for workshop access behavior

## Target Users

White Glove Workshop Coordinators (prepare CSV, run deployments), RHDP Operations (lock/extend/scale during live events), QA/Event Leads (verify deployments pre-handoff).

## Technical Approach

Python 3.7+ CLI + FastAPI backend, React 18/TypeScript/PatternFly 6/Vite frontend, cluster interaction via `oc` CLI (existing login session), CSV input/output (Excel/Sheets compatible), 212 automated tests, dry-run safety on all operations.

## Current Status

Fully implemented and tested on integration cluster. Ready for production use and team adoption.
