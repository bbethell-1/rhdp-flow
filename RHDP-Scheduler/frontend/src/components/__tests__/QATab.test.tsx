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
});
