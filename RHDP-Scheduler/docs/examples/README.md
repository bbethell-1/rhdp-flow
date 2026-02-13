# Example schedule CSVs

Use these as templates or reference when building workshop schedules.

| File | Description |
|------|-------------|
| [basic_workshop.csv](basic_workshop.csv) | Two workshops, required columns only. |
| [minimal_workshop.csv](minimal_workshop.csv) | Single row, minimal required columns. |
| [full_featured.csv](full_featured.csv) | Concurrency, Count, Salesforce IDs, Salesforce_Type. |
| [count_expansion.csv](count_expansion.csv) | `Count=3` — one row expands to three deployments. |
| [count_two_instances.csv](count_two_instances.csv) | `Count=2` — two identical workshop instances. |
| [multi_region.csv](multi_region.csv) | One workshop across 3 AWS regions (comma-separated `AWS_Region`). |
| [one_workshop_two_regions.csv](one_workshop_two_regions.csv) | One workshop split across 2 AWS regions (e.g. `us-east-1,eu-west-1`). |
| [multi_asset_legacy.csv](multi_asset_legacy.csv) | Single-row multi-asset (Multi_Asset=True, Asset_CIs). |
| [multi_asset_grouped.csv](multi_asset_grouped.csv) | Grouped multi-asset (same Multi_Workshop_Name, one row per asset). |
| [no_auto_stop.csv](no_auto_stop.csv) | Empty Auto-stop (UTC) — no auto-stop time set. |
| [event_catalog_item.csv](event_catalog_item.csv) | Event catalog item (`.event` CI). |
| [salesforce_multi_type.csv](salesforce_multi_type.csv) | Salesforce IDs with campaign/cdh and multi-type (opportunity;campaign;project;cdh). |
| [two_workshops_same_namespace.csv](two_workshops_same_namespace.csv) | Two different workshops in the same namespace. |

See the [main README](../../README.md#csv-format) for full CSV column reference.
