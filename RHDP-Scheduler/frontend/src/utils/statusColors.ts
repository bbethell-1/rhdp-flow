/** Shared status → CSS class mapping for deployment and QA results. */

import type { ComponentType, CSSProperties } from 'react';
import CheckCircleIcon from '@patternfly/react-icons/dist/esm/icons/check-circle-icon';
import ExclamationCircleIcon from '@patternfly/react-icons/dist/esm/icons/exclamation-circle-icon';
import ExclamationTriangleIcon from '@patternfly/react-icons/dist/esm/icons/exclamation-triangle-icon';

export function statusColorClass(status: string): string {
  if (!status) return '';
  const s = status.toLowerCase();
  if (s.includes('verified') && !s.includes('unverified')) return 'status-verified';
  if (s.includes('unverified') || s.includes('no_url')) return 'status-deployed_unverified';
  if (s.includes('failed') || s.includes('error')) return 'status-failed';
  return '';
}

/** Returns a PatternFly icon component matching the status for accessibility (color + icon). */
export function statusIcon(status: string): ComponentType<{ style?: CSSProperties }> | null {
  if (!status) return null;
  const s = status.toLowerCase();
  if ((s.includes('verified') && !s.includes('unverified')) || s === 'success') return CheckCircleIcon;
  if (s.includes('unverified') || s.includes('no_url')) return ExclamationTriangleIcon;
  if (s.includes('failed') || s.includes('error')) return ExclamationCircleIcon;
  return null;
}
