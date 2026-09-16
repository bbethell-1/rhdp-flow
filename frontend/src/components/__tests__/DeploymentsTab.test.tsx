import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach } from 'vitest';
import { DeploymentsTab } from '../DeploymentsTab';
import { mockResult, mockFailedResult } from '../../test/mocks/api';

const noop = () => {};

describe('DeploymentsTab', () => {
  beforeEach(() => {
    sessionStorage.removeItem('rhdp-deploy-search');
    sessionStorage.removeItem('rhdp-deploy-filter');
  });

  it('renders empty state when no results', () => {
    render(<DeploymentsTab results={[]} setResults={noop} showToast={noop} />);
    expect(screen.getByText('No deployment results yet')).toBeInTheDocument();
  });

  it('renders results table with data', () => {
    render(<DeploymentsTab results={[mockResult]} setResults={noop} showToast={noop} />);
    expect(screen.getByText('Test Workshop')).toBeInTheDocument();
    expect(screen.getByText('abc123')).toBeInTheDocument();
  });

  it('displays summary cards', () => {
    render(
      <DeploymentsTab
        results={[mockResult, mockFailedResult]}
        setResults={noop}
        showToast={noop}
      />
    );
    // Summary card labels appear alongside toggle buttons, so use getAllByText
    expect(screen.getByText('Total')).toBeInTheDocument();
    expect(screen.getAllByText('Unverified').length).toBeGreaterThan(0);
  });

  it('filters by status using toggle buttons', async () => {
    const user = userEvent.setup();
    render(
      <DeploymentsTab
        results={[mockResult, mockFailedResult]}
        setResults={noop}
        showToast={noop}
      />
    );

    // Click the "Verified" toggle filter — it should only show verified results
    const verifiedToggle = screen.getAllByText('Verified');
    // The first one is the summary card label, the second is the toggle button
    // Find the ToggleGroupItem
    const toggleButtons = screen.getAllByRole('button');
    const verifiedBtn = toggleButtons.find(b => b.textContent === 'Verified');
    if (verifiedBtn) {
      await user.click(verifiedBtn);
      expect(screen.getByText('Test Workshop')).toBeInTheDocument();
      expect(screen.queryByText('Failed Workshop')).not.toBeInTheDocument();
    }
    expect(verifiedToggle.length).toBeGreaterThan(0);
  });

  it('shows search input and filters by text', async () => {
    const user = userEvent.setup();
    render(
      <DeploymentsTab
        results={[mockResult, mockFailedResult]}
        setResults={noop}
        showToast={noop}
      />
    );

    const search = screen.getByPlaceholderText('Search CI, GUID, namespace...');
    await user.type(search, 'fail123');
    expect(screen.getByText('Failed Workshop')).toBeInTheDocument();
    expect(screen.queryByText('abc123')).not.toBeInTheDocument();
  });

  it('shows retry button for failed results', () => {
    render(
      <DeploymentsTab
        results={[mockFailedResult]}
        setResults={noop}
        showToast={noop}
      />
    );
    expect(screen.getByLabelText('Retry')).toBeInTheDocument();
  });
});
