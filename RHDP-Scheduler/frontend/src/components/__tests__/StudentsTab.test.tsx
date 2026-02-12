import { render, screen } from '@testing-library/react';
import { StudentsTab } from '../StudentsTab';
import { mockQAResult } from '../../test/mocks/api';

describe('StudentsTab', () => {
  it('renders empty state when no student data', () => {
    render(<StudentsTab qaResults={[]} />);
    expect(screen.getByText('No student data')).toBeInTheDocument();
  });

  it('renders student table with landing page URLs', () => {
    render(<StudentsTab qaResults={[mockQAResult]} />);
    expect(screen.getByText('Student Landing Pages (1)')).toBeInTheDocument();
    expect(screen.getByText(mockQAResult.landing_page_url)).toBeInTheDocument();
  });

  it('shows copy URL button', () => {
    render(<StudentsTab qaResults={[mockQAResult]} />);
    expect(screen.getByLabelText('Copy URL')).toBeInTheDocument();
  });

  it('shows Download CSV button', () => {
    render(<StudentsTab qaResults={[mockQAResult]} />);
    expect(screen.getByText('Download CSV')).toBeInTheDocument();
  });
});
