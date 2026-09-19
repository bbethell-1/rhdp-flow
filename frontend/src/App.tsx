import { useState, useCallback, useRef, useEffect, lazy, Suspense } from 'react';
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
  Spinner,
  Tooltip,
} from '@patternfly/react-core';

import type {
  WorkshopSchedule,
  DeploymentResult,
  QAResult,
} from './types';

import { api, clearApiKey } from './services/api';
import { TOAST_DURATION_MS } from './constants';
import { useTheme } from './hooks/useTheme';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { HealthBadge } from './components/HealthBadge';
import { SessionHistory } from './components/SessionHistory';

const UploadTab = lazy(() => import('./components/UploadTab').then(m => ({ default: m.UploadTab })));
const ScheduleEditPage = lazy(() =>
  import('./components/ScheduleEditPage').then(m => ({ default: m.ScheduleEditPage })),
);
const DeploymentsTab = lazy(() => import('./components/DeploymentsTab').then(m => ({ default: m.DeploymentsTab })));
const OperationsTab = lazy(() => import('./components/OperationsTab').then(m => ({ default: m.OperationsTab })));
const QATab = lazy(() => import('./components/QATab').then(m => ({ default: m.QATab })));
const StudentsTab = lazy(() => import('./components/StudentsTab').then(m => ({ default: m.StudentsTab })));

const VALID_TABS = ['upload', 'deployments', 'operations', 'qa', 'students'];

function getTabFromHash(): string {
  const hash = window.location.hash.replace('#', '');
  return VALID_TABS.includes(hash) ? hash : 'upload';
}

const App: React.FC = () => {
  const { theme, toggleTheme } = useTheme();
  const [locationHash, setLocationHash] = useState(() => window.location.hash);
  const [activeTab, setActiveTab] = useState<string | number>(getTabFromHash);
  const [dryRun, setDryRun] = useState(true);
  const [schedules, setSchedules] = useState<WorkshopSchedule[]>([]);
  const [results, setResults] = useState<DeploymentResult[]>([]);
  const [qaResults, setQAResults] = useState<QAResult[]>([]);
  const [viewingSession, setViewingSession] = useState(false);
  const [deployLogFile, setDeployLogFile] = useState<string | null>(null);
  const [toast, setToast] = useState<{ msg: string; variant: 'success' | 'danger' | 'info' } | null>(null);
  const [showHelp, setShowHelp] = useState(false);

  const toastTimer = useRef<ReturnType<typeof setTimeout>>();

  const showToast = useCallback((msg: string, variant: 'success' | 'danger' | 'info' = 'info') => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ msg, variant });
    toastTimer.current = setTimeout(() => setToast(null), TOAST_DURATION_MS);
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
    } catch (e) {
      console.warn('Failed to restore current session', e);
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
    setDeployLogFile(null);
    setViewingSession(false);
  }, []);

  const studentsCount = qaResults.filter(r => r.landing_page_url).length;

  const editView = locationHash === '#edit';

  // Update document title and URL hash based on active tab (skip when full editor is open)
  useEffect(() => {
    if (editView) {
      document.title = 'RHDP-Flow | Edit schedules';
      return;
    }
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
  }, [activeTab, editView]);

  // Sync tab + hash state on browser navigation; #edit is a separate full-page view
  useEffect(() => {
    const handler = () => {
      const h = window.location.hash;
      setLocationHash(h);
      const key = h.replace(/^#/, '') || 'upload';
      if (key === 'edit') return;
      if (VALID_TABS.includes(key)) setActiveTab(key);
    };
    window.addEventListener('hashchange', handler);
    return () => window.removeEventListener('hashchange', handler);
  }, []);

  // Keyboard shortcuts
  const handleTabShortcut = useCallback((tab: string) => setActiveTab(tab), []);
  const handleHelpToggle = useCallback(() => setShowHelp(prev => !prev), []);
  useKeyboardShortcuts(handleTabShortcut, handleHelpToggle, !editView);

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
                <Tooltip content="Makes deployment jobs simulate without provisioning resources. Check prerequisites and Preview deployment never provision resources, regardless of this setting. All require the backend.">
                  <Checkbox
                    label="Dry-Run Mode"
                    isChecked={dryRun}
                    onChange={(_e, checked) => setDryRun(checked)}
                    id="globalDryRun"
                  />
                </Tooltip>
                <HealthBadge />
                <Tooltip content="All schedule and deployment times are displayed in UTC. Your local timezone is shown for reference.">
                  <span className="tz-indicator">
                    Times in UTC | You: {Intl.DateTimeFormat().resolvedOptions().timeZone}
                  </span>
                </Tooltip>
                <Tooltip content="Toggle between light and dark theme">
                  <button className="theme-toggle" onClick={toggleTheme} aria-label="Toggle theme" aria-pressed={theme === 'dark'}>
                    {theme === 'dark' ? 'Light mode' : 'Dark mode'}
                  </button>
                </Tooltip>
                <Tooltip content="Change or clear the stored API key">
                  <button className="theme-toggle" onClick={() => { clearApiKey(); window.location.reload(); }} aria-label="Change API key">
                    Change key
                  </button>
                </Tooltip>
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

      <div aria-live="polite" role="status">
        {toast && (
          <PageSection padding={{ default: 'noPadding' }} style={{ padding: '8px 24px 0' }}>
            <Alert variant={toast.variant} title={toast.msg} isInline isPlain timeout={3500} onTimeout={() => setToast(null)} />
          </PageSection>
        )}
      </div>

      {!editView && (
        <PageSection padding={{ default: 'noPadding' }} style={{ padding: '0 24px' }}>
          <SessionHistory
            onView={handleSessionView}
            onBack={handleBackToCurrent}
            viewingSession={viewingSession}
            showToast={showToast}
          />
        </PageSection>
      )}

      <PageSection isFilled>
        {editView ? (
          <Suspense fallback={<Spinner />}>
            <ScheduleEditPage showToast={showToast} />
          </Suspense>
        ) : (
          <Tabs
            activeKey={activeTab}
            onSelect={(_e, key) => setActiveTab(key)}
            aria-label="RHDP-Flow tabs"
          >
            <Tab
              eventKey="upload"
              title={<TabTitleText>Upload &amp; Deploy{schedules.length > 0 && <Badge className="tab-badge" isRead>{schedules.length}</Badge>}</TabTitleText>}
            >
              <Suspense fallback={<Spinner />}>
                <UploadTab
                  dryRun={dryRun}
                  schedules={schedules}
                  setSchedules={setSchedules}
                  results={results}
                  setResults={setResults}
                  showToast={showToast}
                  onClear={handleClear}
                  setDeployLogFile={setDeployLogFile}
                />
              </Suspense>
            </Tab>
            <Tab
              eventKey="deployments"
              title={<TabTitleText>Deployments{results.length > 0 && <Badge className="tab-badge" isRead>{results.length}</Badge>}</TabTitleText>}
            >
              <Suspense fallback={<Spinner />}>
                <DeploymentsTab
                  results={results}
                  setResults={setResults}
                  showToast={showToast}
                  deployLogFile={deployLogFile}
                />
              </Suspense>
            </Tab>
            <Tab eventKey="operations" title={<TabTitleText>Operations</TabTitleText>}>
              <Suspense fallback={<Spinner />}>
                <OperationsTab showToast={showToast} schedules={schedules} />
              </Suspense>
            </Tab>
            <Tab
              eventKey="qa"
              title={<TabTitleText>QA{qaResults.length > 0 && <Badge className="tab-badge" isRead>{qaResults.length}</Badge>}</TabTitleText>}
            >
              <Suspense fallback={<Spinner />}>
                <QATab
                  qaResults={qaResults}
                  setQAResults={setQAResults}
                  showToast={showToast}
                />
              </Suspense>
            </Tab>
            <Tab
              eventKey="students"
              title={<TabTitleText>Students{studentsCount > 0 && <Badge className="tab-badge" isRead>{studentsCount}</Badge>}</TabTitleText>}
            >
              <Suspense fallback={<Spinner />}>
                <StudentsTab qaResults={qaResults} showToast={showToast} />
              </Suspense>
            </Tab>
          </Tabs>
        )}
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
