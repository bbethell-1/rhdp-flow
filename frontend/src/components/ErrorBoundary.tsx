import React from 'react';
import {
  EmptyState,
  EmptyStateBody,
  Button,
} from '@patternfly/react-core';
import ExclamationCircleIcon from '@patternfly/react-icons/dist/esm/icons/exclamation-circle-icon';

interface State {
  hasError: boolean;
}

export class ErrorBoundary extends React.Component<React.PropsWithChildren, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.warn('ErrorBoundary caught an error', error, info);
  }

  handleRetry = () => {
    this.setState({ hasError: false });
  };

  render() {
    if (this.state.hasError) {
      return (
        <EmptyState titleText="Something went wrong" headingLevel="h2" icon={ExclamationCircleIcon}>
          <EmptyStateBody>An unexpected error occurred. Please try again.</EmptyStateBody>
          <Button variant="primary" onClick={this.handleRetry}>Try Again</Button>
        </EmptyState>
      );
    }
    return this.props.children;
  }
}
