import type { WorkshopSchedule } from '../types';

/** New row for the schedule builder (matches API / CSV defaults). */
export function createBlankWorkshopSchedule(): WorkshopSchedule {
  return {
    ci_name: '',
    ci: '',
    namespace: '',
    users: null,
    enable_workshop_interface: true,
    password: '',
    activity: 'Admin',
    purpose: 'QA',
    workshop_name: '',
    provisioning_date: '',
    auto_stop: '',
    auto_destroy: '',
    is_multi_asset: false,
    asset_cis: '',
    multi_workshop_name: '',
    concurrency: 1,
    instances: null,
    salesforce_ids: '',
    salesforce_type: 'opportunity',
    aws_regions: '',
    count: null,
    white_glove: true,
    redirect: true,
    showroom_repo: '',
    showroom_ref: 'main',
    showroom_novnc: false,
    showroom_zerotouch: false,
  };
}
