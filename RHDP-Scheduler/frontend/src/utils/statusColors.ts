/** Shared status → CSS class mapping for deployment and QA results. */

import type { ComponentType, CSSProperties } from 'react';
import CheckCircleIcon from '@patternfly/react-icons/dist/esm/icons/check-circle-icon';
import ExclamationCircleIcon from '@patternfly/react-icons/dist/esm/icons/exclamation-circle-icon';
import ExclamationTriangleIcon from '@patternfly/react-icons/dist/esm/icons/exclamation-triangle-icon';

export type QAStatusCategory = 'success' | 'warning' | 'danger' | 'unknown';

export function qaStatusCategory(status: string): QAStatusCategory {
  if (!status) return 'unknown';
  const s = status.toLowerCase();
  if (
    (s.includes('verified') && !s.includes('unverified')) ||
    s.includes('deployed & ready') ||
    s.includes('multi-workshop') ||
    s.includes('workshop (direct)') ||
    s === 'success'
  ) return 'success';
  if (
    s.includes('healthy') ||
    s.includes('not ready') ||
    s.includes('unverified') ||
    s.includes('no_url')
  ) return 'warning';
  if (
    s.includes('failed') ||
    s.includes('error') ||
    s.includes('not deployed') ||
    s.includes('deployment failed')
  ) return 'danger';
  return 'unknown';
}

export function statusColorClass(status: string): string {
  const cat = qaStatusCategory(status);
  if (cat === 'success') return 'status-verified';
  if (cat === 'warning') return 'status-deployed_unverified';
  if (cat === 'danger') return 'status-failed';
  return '';
}

/** Returns a PatternFly icon component matching the status for accessibility (color + icon). */
export function statusIcon(status: string): ComponentType<{ style?: CSSProperties }> | null {
  const cat = qaStatusCategory(status);
  if (cat === 'success') return CheckCircleIcon;
  if (cat === 'warning') return ExclamationTriangleIcon;
  if (cat === 'danger') return ExclamationCircleIcon;
  return null;
}
