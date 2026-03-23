import type { WorkshopSchedule } from '../types';

/** Headers aligned with GET /api/templates/schedule and read_csv_input. */
export const SCHEDULE_CSV_HEADERS = [
  'CI Name',
  'CI',
  'Namespace',
  'Users',
  'Enable_workshop_interface',
  'Password',
  'Activity',
  'Purpose',
  'Workshop Name',
  'Provisioning Date (UTC)',
  'Auto-stop (UTC)',
  'Auto-destroy (UTC)',
  'Multi_Asset',
  'Asset_CIs',
  'Multi_Workshop_Name',
  'Concurrency',
  'Instances',
  'Salesforce IDs',
  'Salesforce_Type',
  'Count',
  'AWS_Region',
  'Redirect',
  'Showroom_Repo',
  'Showroom_Ref',
  'Showroom_NoVNC',
  'Showroom_Zerotouch',
  'White_Glove',
] as const;

function escCell(v: string): string {
  if (/[",\n\r]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}

function boolCell(b: boolean): string {
  return b ? 'True' : 'False';
}

function optNum(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return '';
  return String(n);
}

/** Build UTF-8 CSV text for download (re-upload compatible). */
export function workshopSchedulesToCsv(rows: WorkshopSchedule[]): string {
  const lines: string[] = [SCHEDULE_CSV_HEADERS.join(',')];
  for (const s of rows) {
    lines.push(
      [
        escCell(s.ci_name),
        escCell(s.ci),
        escCell(s.namespace),
        optNum(s.users),
        boolCell(s.enable_workshop_interface),
        escCell(s.password),
        escCell(s.activity),
        escCell(s.purpose),
        escCell(s.workshop_name || s.ci_name),
        escCell(s.provisioning_date),
        escCell(s.auto_stop),
        escCell(s.auto_destroy),
        boolCell(s.is_multi_asset),
        escCell(s.asset_cis),
        escCell(s.multi_workshop_name),
        optNum(s.concurrency),
        optNum(s.instances),
        escCell(s.salesforce_ids),
        escCell(s.salesforce_type || 'opportunity'),
        optNum(s.count),
        escCell(s.aws_regions || ''),
        boolCell(s.redirect),
        escCell(s.showroom_repo),
        escCell(s.showroom_ref || ''),
        boolCell(s.showroom_novnc),
        boolCell(s.showroom_zerotouch),
        boolCell(s.white_glove),
      ].join(','),
    );
  }
  return `\uFEFF${lines.join('\n')}\n`;
}

export function downloadTextFile(filename: string, text: string, mime = 'text/csv;charset=utf-8') {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
