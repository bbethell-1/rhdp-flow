import { useState, useCallback, useRef, useEffect } from 'react';
import {
  Page,
  Masthead,
  MastheadMain,
  MastheadLogo,
  MastheadBrand,
  MastheadContent,
  PageSection,
  Tabs,
  Tab,
  TabTitleText,
  Toolbar,
  ToolbarContent,
  ToolbarItem,
  Checkbox,
  Alert,
  Badge,
  Modal,
  ModalBody,
  ModalHeader,
} from '@patternfly/react-core';

import type {
  WorkshopSchedule,
  DeploymentResult,
  QAResult,
} from './types';

import { api } from './services/api';
import { useTheme } from './hooks/useTheme';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { HealthBadge } from './components/HealthBadge';
import { SessionHistory } from './components/SessionHistory';
import { UploadTab } from './components/UploadTab';
import { DeploymentsTab } from './components/DeploymentsTab';
import { OperationsTab } from './components/OperationsTab';
import { QATab } from './components/QATab';
import { StudentsTab } from './components/StudentsTab';

const VALID_TABS = ['upload', 'deployments', 'operations', 'qa', 'students'];

function getTabFromHash(): string {
  const hash = window.location.hash.replace('#', '');
  return VALID_TABS.includes(hash) ? hash : 'upload';
}

const App: React.FC = () => {
  const { theme, toggleTheme } = useTheme();
  const [activeTab, setActiveTab] = useState<string | number>(getTabFromHash);
  const [dryRun, setDryRun] = useState(true);
  const [schedules, setSchedules] = useState<WorkshopSchedule[]>([]);
  const [results, setResults] = useState<DeploymentResult[]>([]);
  const [qaResults, setQAResults] = useState<QAResult[]>([]);
  const [viewingSession, setViewingSession] = useState(false);
  const [toast, setToast] = useState<{ msg: string; variant: 'success' | 'danger' | 'info' } | null>(null);
  const [showHelp, setShowHelp] = useState(false);

  const toastTimer = useRef<ReturnType<typeof setTimeout>>();

  const showToast = useCallback((msg: string, variant: 'success' | 'danger' | 'info' = 'info') => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ msg, variant });
    toastTimer.current = setTimeout(() => setToast(null), 4000);
  }, []);

  const handleSessionView = useCallback((data: { schedules: WorkshopSchedule[]; results: DeploymentResult[]; qa_results: QAResult[] }) => {
    setSchedules(data.schedules);
    setResults(data.results);
    setQAResults(data.qa_results);
    setViewingSession(true);
    setActiveTab('deployments');
  }, []);

  const handleBackToCurrent = useCallback(async () => {
    try {
      const [sched, res, qa] = await Promise.all([
        api.getSchedules(),
        api.deployResults(),
        api.qaResults(),
      ]);
      setSchedules(sched);
      setResults(res);
      setQAResults(qa.results);
    } catch {
      setSchedules([]);
      setResults([]);
      setQAResults([]);
    }
    setViewingSession(false);
  }, []);

  const handleClear = useCallback(() => {
    setSchedules([]);
    setResults([]);
    setQAResults([]);
    setViewingSession(false);
  }, []);

  const studentsCount = qaResults.filter(r => r.landing_page_url).length;

  // Update document title and URL hash based on active tab
  useEffect(() => {
    const tabNames: Record<string, string> = {
      upload: 'Upload & Deploy',
      deployments: 'Deployments',
      operations: 'Operations',
      qa: 'QA',
      students: 'Students',
    };
    const name = tabNames[String(activeTab)] || 'Upload & Deploy';
    document.title = `RHDP-Flow | ${name}`;
    window.history.replaceState(null, '', `#${activeTab}`);
  }, [activeTab]);

  // Listen for browser back/forward to update active tab
  useEffect(() => {
    const handler = () => setActiveTab(getTabFromHash());
    window.addEventListener('hashchange', handler);
    return () => window.removeEventListener('hashchange', handler);
  }, []);

  // Keyboard shortcuts
  const handleTabShortcut = useCallback((tab: string) => setActiveTab(tab), []);
  const handleHelpToggle = useCallback(() => setShowHelp(prev => !prev), []);
  useKeyboardShortcuts(handleTabShortcut, handleHelpToggle);

  const masthead = (
    <Masthead className={dryRun ? undefined : 'live-mode'}>
      <MastheadMain>
        <MastheadBrand>
          <MastheadLogo component="span">
            <span className="app-title"><span className="accent">RHDP</span>-Flow</span>
          </MastheadLogo>
        </MastheadBrand>
      </MastheadMain>
      <MastheadContent>
        <Toolbar>
          <ToolbarContent>
            <ToolbarItem>
              <div className="masthead-controls">
                <Checkbox
                  label="Dry-Run Mode"
                  isChecked={dryRun}
                  onChange={(_e, checked) => setDryRun(checked)}
                  id="globalDryRun"
                />
                <HealthBadge />
                <span className="tz-indicator">
                  Times in UTC | You: {Intl.DateTimeFormat().resolvedOptions().timeZone}
                </span>
                <button className="theme-toggle" onClick={toggleTheme}>
                  {theme === 'dark' ? 'Light mode' : 'Dark mode'}
                </button>
              </div>
            </ToolbarItem>
          </ToolbarContent>
        </Toolbar>
      </MastheadContent>
    </Masthead>
  );

  return (
    <Page masthead={masthead}>
      {/* Persistent live-mode warning when dry-run is off */}
      {!dryRun && (
        <PageSection padding={{ default: 'noPadding' }} style={{ padding: '8px 24px 0' }}>
          <Alert variant="danger" isInline title="LIVE MODE — Dry-run is disabled. Deployments will provision real resources." />
        </PageSection>
      )}

      {toast && (
        <PageSection padding={{ default: 'noPadding' }} style={{ padding: '8px 24px 0' }}>
          <Alert variant={toast.variant} title={toast.msg} isInline isPlain timeout={3500} onTimeout={() => setToast(null)} />
        </PageSection>
      )}

      <PageSection padding={{ default: 'noPadding' }} style={{ padding: '0 24px' }}>
        <SessionHistory
          onView={handleSessionView}
          onBack={handleBackToCurrent}
          viewingSession={viewingSession}
          showToast={showToast}
        />
      </PageSection>

      <PageSection isFilled>
        <Tabs
          activeKey={activeTab}
          onSelect={(_e, key) => setActiveTab(key)}
          aria-label="RHDP-Flow tabs"
        >
          <Tab
            eventKey="upload"
            title={<TabTitleText>Upload &amp; Deploy{schedules.length > 0 && <Badge className="tab-badge" isRead>{schedules.length}</Badge>}</TabTitleText>}
          >
            <UploadTab
              dryRun={dryRun}
              schedules={schedules}
              setSchedules={setSchedules}
              results={results}
              setResults={setResults}
              showToast={showToast}
              onClear={handleClear}
            />
          </Tab>
          <Tab
            eventKey="deployments"
            title={<TabTitleText>Deployments{results.length > 0 && <Badge className="tab-badge" isRead>{results.length}</Badge>}</TabTitleText>}
          >
            <DeploymentsTab
              results={results}
              setResults={setResults}
              showToast={showToast}
            />
          </Tab>
          <Tab eventKey="operations" title={<TabTitleText>Operations</TabTitleText>}>
            <OperationsTab showToast={showToast} schedules={schedules} />
          </Tab>
          <Tab
            eventKey="qa"
            title={<TabTitleText>QA{qaResults.length > 0 && <Badge className="tab-badge" isRead>{qaResults.length}</Badge>}</TabTitleText>}
          >
            <QATab
              qaResults={qaResults}
              setQAResults={setQAResults}
              showToast={showToast}
            />
          </Tab>
          <Tab
            eventKey="students"
            title={<TabTitleText>Students{studentsCount > 0 && <Badge className="tab-badge" isRead>{studentsCount}</Badge>}</TabTitleText>}
          >
            <StudentsTab qaResults={qaResults} />
          </Tab>
        </Tabs>
      </PageSection>

      {/* Keyboard shortcuts help modal */}
      <Modal
        variant="small"
        isOpen={showHelp}
        onClose={() => setShowHelp(false)}
        aria-labelledby="shortcuts-help-title"
      >
        <ModalHeader title="Keyboard Shortcuts" labelId="shortcuts-help-title" />
        <ModalBody>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <tbody>
              {[
                ['1', 'Upload & Deploy tab'],
                ['2', 'Deployments tab'],
                ['3', 'Operations tab'],
                ['4', 'QA tab'],
                ['5', 'Students tab'],
                ['?', 'Toggle this help'],
              ].map(([key, desc]) => (
                <tr key={key} style={{ borderBottom: '1px solid var(--pf-v6-global--BorderColor--100, #d2d2d2)' }}>
                  <td style={{ padding: '6px 12px', fontFamily: 'monospace', fontWeight: 700 }}>{key}</td>
                  <td style={{ padding: '6px 12px' }}>{desc}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </ModalBody>
      </Modal>
    </Page>
  );
};

export default App;
