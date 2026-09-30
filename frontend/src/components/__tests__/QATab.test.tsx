import { render, screen } from '@testing-library/react';
import { QATab } from '../QATab';
import { mockQAResult } from '../../test/mocks/api';

const noop = () => {};

describe('QATab', () => {
  it('renders empty state when no QA results', () => {
    render(<QATab qaResults={[]} setQAResults={noop} showToast={noop} />);
    expect(screen.getByText('No QA results yet')).toBeInTheDocument();
  });

  it('renders QA type selector', () => {
    render(<QATab qaResults={[]} setQAResults={noop} showToast={noop} />);
    expect(screen.getByLabelText('QA type')).toBeInTheDocument();
  });

  it('renders guidance alert and floor scope on QA card', () => {
    render(<QATab qaResults={[]} setQAResults={noop} showToast={noop} />);
    expect(screen.getByText('Keep it simple')).toBeInTheDocument();
    expect(screen.getByText('Catalog → Setup → Healthy')).toBeInTheDocument();
    expect(screen.getByLabelText('QA floor scope: this day or full event')).toBeInTheDocument();
  });

  it('renders results table with QA data', () => {
    render(<QATab qaResults={[mockQAResult]} setQAResults={noop} showToast={noop} />);
    expect(screen.getByText(/QA Results \(1/)).toBeInTheDocument();
    expect(screen.getByText('Test Workshop')).toBeInTheDocument();
    expect(screen.getByText('test-ns')).toBeInTheDocument();
  });

  it('shows Run QA button', () => {
    render(<QATab qaResults={[]} setQAResults={noop} showToast={noop} />);
    expect(screen.getByRole('button', { name: /Run QA/ })).toBeInTheDocument();
  });

  it('defaults namespace scope to the only schedule namespace', () => {
    const schedules = [
      {
        ci_name: 'W',
        ci: 'w.prod',
        namespace: 'user-bbethell-redhat-com',
        enable_workshop_interface: true,
        password: '',
        activity: 'Workshops',
        purpose: 'QA',
        workshop_name: 'W',
        provisioning_date: '',
        auto_stop: '',
        auto_destroy: '',
      },
    ];
    render(
      <QATab
        qaResults={[]}
        setQAResults={noop}
        showToast={noop}
        schedules={schedules as never}
      />,
    );
    expect(screen.getByLabelText('QA namespace scope')).toHaveValue('user-bbethell-redhat-com');
    expect(screen.getByText(/Run QA for bbethell/)).toBeInTheDocument();
  });

  it('renders Ops Floor This day / Full event scope controls', () => {
    render(<QATab qaResults={[]} setQAResults={noop} showToast={noop} />);
    expect(screen.getByLabelText('QA floor scope: this day or full event')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'This day' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Full event' })).toBeInTheDocument();
  });

  it('shows Retry failed when prior QA has failures', () => {
    render(
      <QATab
        qaResults={[{ ...mockQAResult, status: 'failed', ci_name: 'Broken Lab' }]}
        setQAResults={noop}
        showToast={noop}
      />,
    );
    expect(screen.getByRole('button', { name: /Retry failed \(1\)/ })).toBeInTheDocument();
  });

  it('shows coverage incomplete when QA rows are a subset of floor-scoped workshops', () => {
    const schedules = [
      {
        ci_name: 'Morning Lab',
        ci: 'morning.event',
        namespace: 'ns-a',
        enable_workshop_interface: true,
        password: '',
        activity: 'Workshops',
        purpose: 'QA',
        workshop_name: 'Morning Lab',
        session_date: '2026-05-06',
        provisioning_date: '05/06/2026 09:00',
        auto_stop: '05/06/2026 12:00',
        auto_destroy: '05/06/2026 18:00',
      },
      {
        ci_name: 'Afternoon Lab',
        ci: 'afternoon.event',
        namespace: 'ns-a',
        enable_workshop_interface: true,
        password: '',
        activity: 'Workshops',
        purpose: 'QA',
        workshop_name: 'Afternoon Lab',
        session_date: '2026-05-06',
        provisioning_date: '05/06/2026 15:00',
        auto_stop: '05/06/2026 18:00',
        auto_destroy: '05/07/2026 09:00',
      },
    ];
    render(
      <QATab
        qaResults={[
          {
            ...mockQAResult,
            ci_name: 'Morning Lab',
            ci: 'morning.event',
            namespace: 'ns-a',
            status: 'verified',
            deployed: 'Yes',
            healthy: true,
          },
        ]}
        setQAResults={noop}
        showToast={noop}
        schedules={schedules as never}
      />,
    );
    expect(screen.getByText(/Coverage 1\/2 in current floor scope/)).toBeInTheDocument();
    expect(screen.getByText('QAed')).toBeInTheDocument();
    expect(screen.getByText('Not QAed')).toBeInTheDocument();
    expect(screen.getByText(/QA Results \(1 · 1\/2 QAed in scope\)/)).toBeInTheDocument();
  });
});
