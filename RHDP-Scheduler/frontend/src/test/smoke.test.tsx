import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import App from '../App';

// Mock the fetch API for health check
globalThis.fetch = vi.fn().mockResolvedValue({
  ok: true,
  json: () => Promise.resolve({
    status: 'ok',
    oc_installed: true,
    oc_connected: false,
    cluster_url: '',
    user: '',
    message: '',
    base_domain: '',
    rhdp_api_reachable: false,
  }),
  text: () => Promise.resolve(''),
}) as unknown as typeof fetch;

describe('App', () => {
  it('renders without crashing', () => {
    render(<App />);
    expect(screen.getByText('RHDP')).toBeInTheDocument();
  });

  it('shows the Upload & Deploy tab by default', () => {
    render(<App />);
    expect(screen.getByText('Upload & Deploy')).toBeInTheDocument();
  });

  it('shows dry-run checkbox', () => {
    render(<App />);
    expect(screen.getByLabelText('Dry-Run Mode')).toBeInTheDocument();
  });
});
