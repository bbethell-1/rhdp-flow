import React from 'react';
import ReactDOM from 'react-dom/client';
import '@patternfly/react-core/dist/styles/base.css';
import './index.css';
import App from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ApiKeyGate } from './components/ApiKeyGate';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <ApiKeyGate>
        <App />
      </ApiKeyGate>
    </ErrorBoundary>
  </React.StrictMode>,
);
