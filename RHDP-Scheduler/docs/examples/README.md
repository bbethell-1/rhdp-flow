# Example schedule CSVs

Use these as **templates and reference** when building workshop schedules. Each file illustrates specific scenarios; copy and adjust for your event.

---

## Choose by scenario

| You want… | Use this example |
|-----------|------------------|
| **One workshop, fewest columns** | [minimal_workshop.csv](minimal_workshop.csv) |
| **Two or more separate workshops** | [basic_workshop.csv](basic_workshop.csv) |
| **Same namespace, different CIs/times** | [two_workshops_same_namespace.csv](two_workshops_same_namespace.csv) |
| **One workshop, no user count set** | [users_omitted.csv](users_omitted.csv) |
| **Workshop without student UI (backend only)** | [workshop_ui_disabled.csv](workshop_ui_disabled.csv) |
| **No auto-stop time** | [no_auto_stop.csv](no_auto_stop.csv) |
| **Event catalog item (`.event` CI)** | [event_catalog_item.csv](event_catalog_item.csv) |
| **One Salesforce opportunity** | [single_salesforce_opportunity.csv](single_salesforce_opportunity.csv) |
| **Salesforce campaign / multiple types** | [salesforce_multi_type.csv](salesforce_multi_type.csv) |
| **One workshop → 2 deployments (Count=2)** | [count_two_instances.csv](count_two_instances.csv) |
| **One workshop → 3 deployments (Count=3)** | [count_expansion.csv](count_expansion.csv) |
| **One workshop across 2 AWS regions** | [one_workshop_two_regions.csv](one_workshop_two_regions.csv) |
| **One workshop across 3 AWS regions** | [multi_region.csv](multi_region.csv) |
| **Multi-asset: single row (legacy)** | [multi_asset_legacy.csv](multi_asset_legacy.csv) |
| **Multi-asset: grouped rows, same portal** | [multi_asset_grouped.csv](multi_asset_grouped.csv) |
| **Multi-asset with Instances + Concurrency** | [multi_asset_with_instances.csv](multi_asset_with_instances.csv) |
| **Multi-asset + per-asset passwords (companion file)** | [multi_asset_companion.csv](multi_asset_companion.csv) + `*_passwords.csv` below |
| **Several options in one file** | [full_featured.csv](full_featured.csv) |

---

## All example files

| File | Scenario | Key columns |
|------|----------|-------------|
| [basic_workshop.csv](basic_workshop.csv) | Two workshops, required columns only | CI, Namespace, Users, dates |
| [minimal_workshop.csv](minimal_workshop.csv) | Single workshop, minimal fields | Required columns only |
| [users_omitted.csv](users_omitted.csv) | Users left empty (no seat count set) | `Users` empty |
| [workshop_ui_disabled.csv](workshop_ui_disabled.csv) | No student lab UI | `Enable_workshop_interface=False` |
| [no_auto_stop.csv](no_auto_stop.csv) | No auto-stop time | `Auto-stop (UTC)` empty |
| [event_catalog_item.csv](event_catalog_item.csv) | Event CI (e.g. summit) | CI ending in `.event` |
| [single_salesforce_opportunity.csv](single_salesforce_opportunity.csv) | One Salesforce opportunity ID | `Salesforce IDs`, `Salesforce_Type=opportunity` |
| [salesforce_multi_type.csv](salesforce_multi_type.csv) | Campaign / cdh / multi-type SF | `opportunity:ID;campaign:ID;project:ID;cdh:ID` |
| [two_workshops_same_namespace.csv](two_workshops_same_namespace.csv) | Two workshops, same namespace | Same `Namespace`, different CI/dates |
| [count_two_instances.csv](count_two_instances.csv) | One row → 2 identical deployments | `Count=2` |
| [count_expansion.csv](count_expansion.csv) | One row → 3 deployments | `Count=3` |
| [one_workshop_two_regions.csv](one_workshop_two_regions.csv) | One workshop, 2 AWS regions | `AWS_Region=us-east-1,eu-west-1` |
| [multi_region.csv](multi_region.csv) | One workshop, 3 AWS regions | `AWS_Region` with 3 regions |
| [multi_asset_legacy.csv](multi_asset_legacy.csv) | Multi-asset in a single row | `Multi_Asset=True`, `Asset_CIs=ci1,ci2`, `Multi_Workshop_Name` |
| [multi_asset_grouped.csv](multi_asset_grouped.csv) | Multi-asset: one row per asset, same portal | Same `Multi_Workshop_Name` on each row |
| [multi_asset_with_instances.csv](multi_asset_with_instances.csv) | Multi-asset with seat count and concurrency | `Instances`, `Concurrency`, `Multi_Workshop_Name` |
| [multi_asset_companion.csv](multi_asset_companion.csv) | Multi-asset with **per-asset passwords** | Use with companion file below |
| [full_featured.csv](full_featured.csv) | Mix of options (Concurrency, Count, Salesforce) | Several optionals in one file |

---

## Companion files (per-asset overrides)

For **multi-asset** workshops you can override **passwords** or **user counts** per CI using a companion CSV next to your schedule file.

### Naming

- Schedule: `my_schedule.csv`
- Passwords: **`my_schedule_passwords.csv`** (same base name + `_passwords.csv`)
- Per-asset user counts: **`my_schedule_asset_users.csv`**

### Example

- Schedule: [multi_asset_companion.csv](multi_asset_companion.csv)
- Passwords: [multi_asset_companion_passwords.csv](multi_asset_companion_passwords.csv)

**Passwords file** columns: `CI`, `Password` (one row per catalog item).

**Asset users file** columns: `CI`, `num_users` (or `Users`). Use when only some assets should have a seat count.

The tool loads these automatically when the main CSV is `multi_asset_companion.csv` (it looks for `multi_asset_companion_passwords.csv` in the same directory).

---

## Column reference

See the [main README — CSV format](../../README.md#csv-format) for required and optional columns.
