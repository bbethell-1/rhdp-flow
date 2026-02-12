import { describe, it, expect } from 'vitest';
import { statusColorClass } from '../statusColors';

describe('statusColorClass', () => {
  it('returns verified class for "verified"', () => {
    expect(statusColorClass('verified')).toBe('status-verified');
  });

  it('returns unverified class for "deployed_unverified"', () => {
    expect(statusColorClass('deployed_unverified')).toBe('status-deployed_unverified');
  });

  it('returns unverified class for "deployed_no_url"', () => {
    expect(statusColorClass('deployed_no_url')).toBe('status-deployed_unverified');
  });

  it('returns failed class for "failed"', () => {
    expect(statusColorClass('failed')).toBe('status-failed');
  });

  it('returns failed class for "error"', () => {
    expect(statusColorClass('error')).toBe('status-failed');
  });

  it('returns empty string for empty status', () => {
    expect(statusColorClass('')).toBe('');
  });

  it('returns empty string for unknown status', () => {
    expect(statusColorClass('pending')).toBe('');
  });

  it('is case-insensitive', () => {
    expect(statusColorClass('VERIFIED')).toBe('status-verified');
    expect(statusColorClass('Failed')).toBe('status-failed');
  });
});
