import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ErrorBoundary } from '../ErrorBoundary';

// Suppress console.warn from ErrorBoundary during tests
vi.spyOn(console, 'warn').mockImplementation(() => {});

const ThrowingChild = () => {
  throw new Error('Test error');
};

const GoodChild = () => <div>All good</div>;

describe('ErrorBoundary', () => {
  it('renders children when no error occurs', () => {
    render(
      <ErrorBoundary>
        <GoodChild />
      </ErrorBoundary>
    );
    expect(screen.getByText('All good')).toBeInTheDocument();
  });

  it('renders fallback UI when a child throws', () => {
    render(
      <ErrorBoundary>
        <ThrowingChild />
      </ErrorBoundary>
    );
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    expect(screen.getByText('An unexpected error occurred. Please try again.')).toBeInTheDocument();
    expect(screen.getByText('Try Again')).toBeInTheDocument();
  });

  it('recovers when Try Again is clicked', () => {
    const { rerender } = render(
      <ErrorBoundary>
        <ThrowingChild />
      </ErrorBoundary>
    );
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();

    // Swap children to a non-throwing component first, then click Try Again
    rerender(
      <ErrorBoundary>
        <GoodChild />
      </ErrorBoundary>
    );
    fireEvent.click(screen.getByText('Try Again'));
    expect(screen.getByText('All good')).toBeInTheDocument();
  });
});
