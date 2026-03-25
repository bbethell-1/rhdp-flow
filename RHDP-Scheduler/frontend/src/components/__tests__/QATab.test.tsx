import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QATab } from '../QATab';
import { mockQAResult } from '../../test/mocks/api';
import type { QAResult } from '../../types';

vi.mock('../../services/api', () => ({
  api: {
    qaNamespaces: vi.fn().mockResolvedValue([]),
    runQA: vi.fn().mockResolvedValue({ count: 0, results: [] }),
    qaResults: vi.fn().mockResolvedValue({ count: 0, results: [] }),
  },
}));

const noop = () => {};

const mockQAFailed: QAResult = {
  ci_name: 'Broken Workshop',
  ci: 'vendor.broken.prod',
  namespace: 'test-ns',
  status: 'NOT DEPLOYED',
  deployed: 'No',
  healthy: false,
  expected_users: 10,
  actual_count: 0,
  landing_page_url: '',
};

const mockQAWarning: QAResult = {
  ci_name: 'Slow Workshop',
  ci: 'vendor.slow.prod',
  namespace: 'test-ns',
  status: 'HEALTHY (not ready)',
  deployed: 'Yes',
  healthy: true,
  expected_users: 20,
  actual_count: 20,
  landing_page_url: '',
};

describe('QATab', () => {
  it('renders empty state when no QA results', () => {
    render(<QATab qaResults={[]} setQAResults={noop} showToast={noop} />);
    expect(screen.getByText('No QA results yet')).toBeInTheDocument();
  });

  it('renders QA type selector', () => {
    render(<QATab qaResults={[]} setQAResults={noop} showToast={noop} />);
    expect(screen.getByLabelText('QA type')).toBeInTheDocument();
  });

  it('renders guidance alert', () => {
    render(<QATab qaResults={[]} setQAResults={noop} showToast={noop} />);
    expect(screen.getByText('When to use QA')).toBeInTheDocument();
  });

  it('renders results table with QA data', () => {
    render(<QATab qaResults={[mockQAResult]} setQAResults={noop} showToast={noop} />);
    expect(screen.getByText('QA Results (1)')).toBeInTheDocument();
    expect(screen.getByText('Test Workshop')).toBeInTheDocument();
    expect(screen.getByText('test-ns')).toBeInTheDocument();
  });

  it('shows Run QA button', () => {
    render(<QATab qaResults={[]} setQAResults={noop} showToast={noop} />);
    expect(screen.getByText('Run QA')).toBeInTheDocument();
  });

  it('renders summary cards when results exist', () => {
    const results = [mockQAResult, mockQAFailed, mockQAWarning];
    render(<QATab qaResults={results} setQAResults={noop} showToast={noop} />);
    expect(screen.getByText('Total')).toBeInTheDocument();
    expect(screen.getByText('Passed')).toBeInTheDocument();
    expect(screen.getByText('Failed')).toBeInTheDocument();
    expect(screen.getByText('Warning')).toBeInTheDocument();
  });

  it('filters by status category', async () => {
    const user = userEvent.setup();
    const results = [mockQAResult, mockQAFailed];
    render(<QATab qaResults={results} setQAResults={noop} showToast={noop} />);
    const failedBtn = screen.getByRole('button', { name: /Failed/i });
    await user.click(failedBtn);
    expect(screen.getByText(/1 of 2/)).toBeInTheDocument();
  });

  it('shows search input when results exist', () => {
    render(<QATab qaResults={[mockQAResult]} setQAResults={noop} showToast={noop} />);
    expect(screen.getByPlaceholderText('Search workshop, CI, namespace...')).toBeInTheDocument();
  });

  it('shows download CSV button', () => {
    render(<QATab qaResults={[mockQAResult]} setQAResults={noop} showToast={noop} />);
    expect(screen.getByText('Download CSV')).toBeInTheDocument();
  });
});
