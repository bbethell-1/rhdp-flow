# RHDP-Flow: Business Requirements Document

**Project:** RHDP Workshop Scheduling & Automation Tool
**Prepared for:** John and the White Glove Workshop Team
**Date:** February 2026
**Status:** Implemented

---

## 1. Executive Summary

The Red Hat Demo Platform (RHDP) team currently manages white glove workshop deployments through a largely manual process. Coordinators must individually create ResourceClaims, Workshops, and WorkshopProvisions through the RHDP UI or raw `oc` commands for every scheduled event. This is time-consuming, error-prone, and does not scale as event volume grows.

**RHDP-Flow** is a CLI and web-based automation tool that reads workshop schedules from a simple CSV spreadsheet and handles all deployment orchestration against the RHDP cluster automatically. The tool eliminates repetitive manual work, reduces deployment errors, and gives the team operational controls (lock, extend, scale) that were previously unavailable at scale.

---

## 2. Problem Statement

### Current Pain Points

- **Manual deployment process** — Each workshop requires multiple steps: creating ResourceClaims, enabling the workshop UI, setting up WorkshopProvisions, configuring passwords, and setting action schedules. For a single event with 5 workshops, this can take 30+ minutes of careful manual work.
- **No bulk operations** — There is no way to lock, extend, or scale multiple workshops at once. Each must be patched individually.
- **Error-prone** — Manual entry of JSON payloads, timestamps (in UTC), namespace names, and catalog item IDs leads to frequent mistakes that are difficult to diagnose.
- **No verification** — After deployment, there is no automated way to verify that workshops match the original schedule (correct user counts, timestamps, health status).
- **Multi-asset complexity** — Events requiring multiple catalog items in a single workshop portal (MultiWorkshop) involve an intricate sequence of resource creation and ID lookups that is impractical to do by hand at scale.
- **No audit trail** — Deployment results are not captured systematically, making post-event review difficult.

---

## 3. Proposed Solution

RHDP-Flow automates the full workshop deployment lifecycle via both a Python CLI and a React/PatternFly web UI:

### 3.1 Core Capabilities

| Capability | Description |
|------------|-------------|
| **CSV-Driven Scheduling** | Read workshop schedules from a standard CSV spreadsheet. One row per workshop, with columns for catalog item, namespace, user count, dates, passwords, and options. |
| **Automated Deployment** | For each row, create the appropriate Kubernetes resources (ResourceClaim, Workshop, WorkshopProvision) with correct payloads, annotations, and labels. |
| **Workshop UI Enablement** | Automatically create Workshops with the lab user interface enabled (`labUserInterface.redirect: true`) when specified. |
| **Multi-Asset Workshops** | Support events with multiple catalog items grouped into a single MultiWorkshop portal, each with its own password. |
| **Multi-Region Provisioning** | Distribute users across multiple AWS regions automatically, creating regional WorkshopProvisions with even user distribution. |
| **Multiple Instances** | Deploy N copies of the same workshop from a single CSV row via a Count column. |
| **Dry-Run Mode** | Preview all JSON payloads that would be sent to the cluster without actually creating any resources. Safe for testing and review. |

### 3.2 Operational Controls

| Operation | Description |
|-----------|-------------|
| **Lock** | Toggle `demo.redhat.com/lock-enabled` label on workshops to lock/unlock UI admin settings. |
| **Extend Stop** | Push back the auto-stop time by a specified number of days/hours. |
| **Extend Destroy** | Push back the auto-destroy/lifespan time for both Workshops and WorkshopProvisions. |
| **Scale** | Adjust the seat count (WorkshopProvision `spec.count`) to a target value. |

### 3.3 Data Management

| Operation | Description |
|-----------|-------------|
| **Update Passwords** | Detect changed passwords in the CSV and patch existing workshops on the cluster automatically. |
| **White Glove CSV Import** | Generate a schedule CSV directly from a deployed namespace — discovers Workshops on the cluster and exports them to CSV format. |
| **Master Sheet Sync** | Compare a master scheduling sheet against a local sheet by (CI, Namespace) key; report added, changed, and unchanged rows; write merged output. |

### 3.4 QA & Verification

| Function | Description |
|----------|-------------|
| **QA1: Setup Verification** | Compare the CSV schedule against what is actually deployed in the cluster. Flag mismatches in user counts, timestamps, or missing deployments. |
| **QA2: Deployment Status** | Check health and readiness of all deployed workshops. Report seat counts and provisioning state. |
| **Landing Page Export** | Export student-facing landing page URLs to a CSV for distribution. |
| **Deployment Results** | Write a results CSV after every run with GUIDs, URLs, status, and any error messages. |

### 3.5 Validation & Safety

| Feature | Description |
|---------|-------------|
| **Enhanced CSV Validation** | Duplicate row detection, CI format checks, namespace format checks, user count reasonableness, and date ordering warnings on upload. |
| **Namespace Existence Validation** | After CSV upload, the tool verifies each namespace exists on the cluster and alerts for missing namespaces before deployment. |
| **Salesforce Tracking** | Supports multi-type Salesforce items (`opportunity`, `campaign`, `project`, `cdh`) via `type:id` pairs, attached as RHDP annotations for chargeback reporting. |

### 3.6 User Experience

| Feature | Description |
|---------|-------------|
| **Web UI** | A React/PatternFly 6 web interface for uploading CSVs, configuring deploy settings (lock, redirect, white-glove, concurrency), reviewing schedules, running dry-runs and deployments, and viewing results — all without touching the command line. |
| **Interactive CLI Wizard** | A guided CLI wizard for teams unfamiliar with the CSV format to generate schedule files interactively. |
| **CI Filtering** | Process only a specific catalog item from a larger schedule using `--ci`. |
| **Redirect Toggle** | Configurable `labUserInterface.redirect` setting controls whether users auto-redirect to the lab UI on workshop access. |
| **Debug Mode** | Verbose logging for troubleshooting deployment issues. |

---

## 4. Target Users

- **White Glove Workshop Coordinators** — Primary users who schedule and manage events. They would prepare the CSV and run the tool.
- **RHDP Operations Team** — Would use operational commands (lock, extend, scale) during live events.
- **QA / Event Leads** — Would use verification functions to confirm deployments before handing off to attendees.

---

## 5. Technical Approach

- **Backend:** Python 3.7+ CLI + FastAPI REST API (uvicorn)
- **Frontend:** React 18 + TypeScript + PatternFly 6 + Vite
- **Cluster Interaction:** All operations via `oc` CLI (no direct API authentication needed; uses existing `oc login` session)
- **Input:** Standard CSV files (easily editable in Excel, Google Sheets, or any spreadsheet tool)
- **Output:** Deployment results CSV, QA verification reports, student landing page CSV
- **Dependencies:** Minimal — standard library for core CLI; `rich` for interactive wizard; `fastapi`/`uvicorn` for API; React/PatternFly for web UI
- **Testing:** 212 automated tests covering all functionality (pytest)
- **Safety:** Dry-run mode for all operations; labeled resources for tracking (`rhdp-flow.gpte.redhat.com/scheduled`); CSV validation and namespace checks before deployment

---

## 6. Success Criteria

| Metric | Target |
|--------|--------|
| Deployment time per event | Reduce from 30+ minutes (manual) to under 5 minutes |
| Deployment errors | Eliminate manual entry errors (payloads generated programmatically) |
| Bulk operations | Support lock/extend/scale across all workshops in a single command |
| Verification coverage | 100% of scheduled workshops verified against the CSV |
| Adoption | Tool used for all white glove events within one quarter of release |

---

## 7. Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Breaking change in RHDP cluster API | Tool uses standard `oc` commands and well-known resource types; payloads match existing cluster patterns |
| Incorrect CSV input | Dry-run mode allows preview before any resources are created; CSV validation rejects malformed input |
| Major version bumps in workshop resources | Tool is modular — payload builders can be updated independently |
| Team unfamiliarity with CLI tools | Interactive wizard provides guided experience; clear documentation and example sheets |

---

## 8. Scope Boundaries

**Delivered:**
- Workshop deployment automation from CSV (CLI and Web UI)
- Operational lifecycle commands (lock, extend stop, extend destroy, scale)
- QA verification and reporting (QA1, QA2, landing page export)
- Interactive CSV generation wizard
- Web UI dashboard (React/PatternFly 6)
- Password update detection and patching
- White glove namespace discovery and CSV export
- Master sheet sync and comparison
- Enhanced CSV validation and namespace existence checks
- Multi-type Salesforce chargeback tracking
- Configurable redirect toggle

**Potential future work:**
- Direct Google Sheets API integration for live master sheet sync
- Scheduled automatic sync (cron/daemon mode)
- Role-based access control in the web UI
- Slack/email notifications for deployment status

---

## 9. Current Status

RHDP-Flow is fully implemented and has been tested on the integration cluster with real deployments. The tool is ready for production use. Key metrics:

- **212 automated tests** covering all deployment, operational, and edge-case scenarios
- **End-to-end validated** on `ocp-integration.infra.open.redhat.com` — Workshop + WorkshopProvision creation, lock/unlock, URL generation, and QA verification confirmed working
- **Web UI operational** — CSV upload, deploy settings, dry-run, deployment, and result viewing all functional via browser
- **CLI operational** — All commands (`--dry-run`, `--lock`, `--extend-stop`, `--extend-destroy`, `--scale`, `--update-passwords`, `--import-namespace`, `--sync`, `--wizard`) working

The tool is ready for team adoption and white glove event use.
