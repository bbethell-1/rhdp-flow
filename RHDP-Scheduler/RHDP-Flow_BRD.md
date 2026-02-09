# RHDP-Flow: Business Requirements Document

**Project:** RHDP Workshop Scheduling & Automation Tool
**Prepared for:** John and the White Glove Workshop Team
**Date:** February 2026
**Status:** Proposed

---

## 1. Executive Summary

The Red Hat Demo Platform (RHDP) team currently manages white glove workshop deployments through a largely manual process. Coordinators must individually create ResourceClaims, Workshops, and WorkshopProvisions through the RHDP UI or raw `oc` commands for every scheduled event. This is time-consuming, error-prone, and does not scale as event volume grows.

We propose building **RHDP-Flow**, a CLI-based automation tool that reads workshop schedules from a simple CSV spreadsheet and handles all deployment orchestration against the RHDP cluster automatically. The tool would eliminate repetitive manual work, reduce deployment errors, and give the team operational controls (lock, extend, scale) they currently lack.

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

Build a Python CLI tool (**RHDP-Flow**) that automates the full workshop deployment lifecycle:

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
| **Lock** | Immediately stop all workshops from a schedule by setting their stop time to now. |
| **Extend Stop** | Push back the auto-stop time by a specified number of days/hours. |
| **Extend Destroy** | Push back the auto-destroy/lifespan time for both Workshops and WorkshopProvisions. |
| **Scale** | Adjust the seat count (WorkshopProvision `spec.count`) to a target value. |

### 3.3 QA & Verification

| Function | Description |
|----------|-------------|
| **QA1: Setup Verification** | Compare the CSV schedule against what is actually deployed in the cluster. Flag mismatches in user counts, timestamps, or missing deployments. |
| **QA2: Deployment Status** | Check health and readiness of all deployed workshops. Report seat counts and provisioning state. |
| **Landing Page Export** | Export student-facing landing page URLs to a CSV for distribution. |
| **Deployment Results** | Write a results CSV after every run with GUIDs, URLs, status, and any error messages. |

### 3.4 User Experience

| Feature | Description |
|---------|-------------|
| **Interactive Wizard** | A guided CLI wizard for teams unfamiliar with the CSV format to generate schedule files interactively. |
| **CI Filtering** | Process only a specific catalog item from a larger schedule using `--ci`. |
| **Debug Mode** | Verbose logging for troubleshooting deployment issues. |

---

## 4. Target Users

- **White Glove Workshop Coordinators** — Primary users who schedule and manage events. They would prepare the CSV and run the tool.
- **RHDP Operations Team** — Would use operational commands (lock, extend, scale) during live events.
- **QA / Event Leads** — Would use verification functions to confirm deployments before handing off to attendees.

---

## 5. Technical Approach

- **Language:** Python 3.7+
- **Cluster Interaction:** All operations via `oc` CLI (no direct API authentication needed; uses existing `oc login` session)
- **Input:** Standard CSV files (easily editable in Excel, Google Sheets, or any spreadsheet tool)
- **Output:** Deployment results CSV, QA verification reports, student landing page CSV
- **Dependencies:** Minimal — standard library only for core functionality; `rich` library optional for the interactive wizard
- **Safety:** Dry-run mode for all operations; labeled resources for tracking (`rhdp-flow.gpte.redhat.com/scheduled`)

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

**In scope:**
- Workshop deployment automation from CSV
- Operational lifecycle commands (lock, extend, scale)
- QA verification and reporting
- Interactive CSV generation wizard

**Out of scope (potential future work):**
- Direct Google Sheets / master sheet integration
- Automatic password rotation on deployed workshops
- CSV generation from existing cluster state (white glove namespace discovery)
- Web UI or dashboard (CLI-only for v1)

---

## 9. Requested Approval

We are requesting approval to proceed with development of RHDP-Flow as described above. The tool addresses a clear operational gap in white glove workshop management and would significantly reduce manual effort and deployment errors for the team.
