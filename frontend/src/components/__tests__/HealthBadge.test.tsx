import { render, screen, waitFor } from '@testing-library/react';
import { HealthBadge } from '../HealthBadge';

// Mock the api module
vi.mock('../../services/api', () => ({
  api: {
    health: vi.fn(),
  },
}));

import { api } from '../../services/api';

describe('HealthBadge', () => {
  it('renders initial state as "--"', () => {
    (api.health as ReturnType<typeof vi.fn>).mockReturnValue(new Promise(() => {})); // never resolves
    render(<HealthBadge />);
    expect(screen.getByText('--')).toBeInTheDocument();
  });

  it('renders green label with user@cluster on healthy response', async () => {
    (api.health as ReturnType<typeof vi.fn>).mockResolvedValue({
      status: 'ok',
      oc_installed: true,
      oc_connected: true,
      cluster_url: 'https://api.cluster.example.com:6443',
      user: 'admin',
      base_domain: 'apps.example.com',
      rhdp_api_reachable: true,
    });

    render(<HealthBadge />);
    await waitFor(() => {
      expect(screen.getByText(/admin/)).toBeInTheDocument();
    });
  });

  it('renders red label on error response', async () => {
    (api.health as ReturnType<typeof vi.fn>).mockResolvedValue({
      status: 'error',
      oc_installed: false,
      oc_connected: false,
      message: 'oc not found',
    });

    render(<HealthBadge />);
    await waitFor(() => {
      expect(screen.getByText('oc not found')).toBeInTheDocument();
    });
  });

  it('handles API failure gracefully', async () => {
    (api.health as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Network error'));

    render(<HealthBadge />);
    await waitFor(() => {
      expect(screen.getByText('API unreachable')).toBeInTheDocument();
    });
  });
});
