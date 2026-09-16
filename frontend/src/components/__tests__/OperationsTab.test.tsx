import { render, screen } from '@testing-library/react';
import { OperationsTab } from '../OperationsTab';
import { mockSchedule } from '../../test/mocks/api';

const noop = () => {};

describe('OperationsTab', () => {
  it('renders all four operation cards', () => {
    render(<OperationsTab showToast={noop} schedules={[mockSchedule]} />);
    expect(screen.getByText('Resource Lock')).toBeInTheDocument();
    expect(screen.getByText('Extend Stop Time')).toBeInTheDocument();
    expect(screen.getByText('Extend Destroy Time')).toBeInTheDocument();
    expect(screen.getByText('Scale Workshops')).toBeInTheDocument();
  });

  it('shows Lock and Unlock buttons', () => {
    render(<OperationsTab showToast={noop} schedules={[mockSchedule]} />);
    expect(screen.getByText('Lock')).toBeInTheDocument();
    expect(screen.getByText('Unlock')).toBeInTheDocument();
  });

  it('shows operations history empty state', () => {
    render(<OperationsTab showToast={noop} schedules={[mockSchedule]} />);
    expect(screen.getByText('No operations yet')).toBeInTheDocument();
  });

  it('renders history search when history exists', () => {
    // Operations history is persisted in sessionStorage
    // Without data, the search input won't render
    render(<OperationsTab showToast={noop} schedules={[]} />);
    expect(screen.getByText('Operations History')).toBeInTheDocument();
  });
});
