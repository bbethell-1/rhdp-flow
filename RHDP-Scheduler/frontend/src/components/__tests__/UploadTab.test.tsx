import { render, screen } from '@testing-library/react';
import { UploadTab } from '../UploadTab';
import { mockSchedule } from '../../test/mocks/api';

const noop = () => {};

describe('UploadTab', () => {
  it('renders empty state when no schedules loaded', () => {
    render(
      <UploadTab
        dryRun={true}
        schedules={[]}
        setSchedules={noop}
        results={[]}
        setResults={noop}
        showToast={noop}
        onClear={noop}
      />
    );
    expect(screen.getByText('No schedules loaded')).toBeInTheDocument();
  });

  it('renders schedule preview table when schedules exist', () => {
    render(
      <UploadTab
        dryRun={true}
        schedules={[mockSchedule]}
        setSchedules={noop}
        results={[]}
        setResults={noop}
        showToast={noop}
        onClear={noop}
      />
    );
    expect(screen.getByText(/Schedule Preview/)).toBeInTheDocument();
    expect(screen.getByDisplayValue('Test Workshop')).toBeInTheDocument();
    expect(screen.getByDisplayValue('vendor.test.prod')).toBeInTheDocument();
  });

  it('renders upload and clear buttons', () => {
    render(
      <UploadTab
        dryRun={true}
        schedules={[]}
        setSchedules={noop}
        results={[]}
        setResults={noop}
        showToast={noop}
        onClear={noop}
      />
    );
    expect(screen.getByText('Upload')).toBeInTheDocument();
    expect(screen.getByText('Clear / New Upload')).toBeInTheDocument();
  });

  it('renders deploy settings card with schedules loaded', () => {
    render(
      <UploadTab
        dryRun={true}
        schedules={[mockSchedule]}
        setSchedules={noop}
        results={[]}
        setResults={noop}
        showToast={noop}
        onClear={noop}
      />
    );
    expect(screen.getByText('Deploy Settings')).toBeInTheDocument();
    expect(screen.getByText('Lock UI Admin Settings')).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Lock row edits' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Full editor \(new tab\)/ })).toBeInTheDocument();
    expect(screen.getByText('Enable Resource Pools')).toBeInTheDocument();
    expect(screen.getByText('White Glove')).toBeInTheDocument();
  });

  it('renders validate, dry-run, download YAML, and deploy buttons when schedules loaded', () => {
    render(
      <UploadTab
        dryRun={true}
        schedules={[mockSchedule]}
        setSchedules={noop}
        results={[]}
        setResults={noop}
        showToast={noop}
        onClear={noop}
      />
    );
    expect(screen.getByText('Validate')).toBeInTheDocument();
    expect(screen.getByText('Dry-run')).toBeInTheDocument();
    expect(screen.getByText('Download YAML')).toBeInTheDocument();
    expect(screen.getByText('Deploy (dry-run)')).toBeInTheDocument();
  });

  it('shows "Deploy" button text when not in dry-run mode', () => {
    render(
      <UploadTab
        dryRun={false}
        schedules={[mockSchedule]}
        setSchedules={noop}
        results={[]}
        setResults={noop}
        showToast={noop}
        onClear={noop}
      />
    );
    expect(screen.getByText('Deploy')).toBeInTheDocument();
  });

  it('shows UTC timezone info alert when schedules are loaded', () => {
    render(
      <UploadTab
        dryRun={true}
        schedules={[mockSchedule]}
        setSchedules={noop}
        results={[]}
        setResults={noop}
        showToast={noop}
        onClear={noop}
      />
    );
    expect(screen.getByText(/All schedule times are in UTC/)).toBeInTheDocument();
  });

  it('shows download CSV template link', () => {
    render(
      <UploadTab
        dryRun={true}
        schedules={[mockSchedule]}
        setSchedules={noop}
        results={[]}
        setResults={noop}
        showToast={noop}
        onClear={noop}
      />
    );
    expect(screen.getByText('Download CSV Template')).toBeInTheDocument();
  });

  it('shows search input for filtering schedule preview', () => {
    render(
      <UploadTab
        dryRun={true}
        schedules={[mockSchedule]}
        setSchedules={noop}
        results={[]}
        setResults={noop}
        showToast={noop}
        onClear={noop}
      />
    );
    expect(screen.getByPlaceholderText('Search schedules...')).toBeInTheDocument();
  });

  it('shows Upload Passwords button', () => {
    render(
      <UploadTab
        dryRun={true}
        schedules={[]}
        setSchedules={noop}
        results={[]}
        setResults={noop}
        showToast={noop}
        onClear={noop}
      />
    );
    expect(screen.getByText('Upload Passwords')).toBeInTheDocument();
  });
});
