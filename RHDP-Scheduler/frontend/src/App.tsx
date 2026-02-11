import { useState, useCallback, useRef } from 'react';
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
} from '@patternfly/react-core';

import type {
  WorkshopSchedule,
  DeploymentResult,
  QAResult,
} from './types';

import { api } from './services/api';
import { useTheme } from './hooks/useTheme';
import { HealthBadge } from './components/HealthBadge';
import { SessionHistory } from './components/SessionHistory';
import { UploadTab } from './components/UploadTab';
import { DeploymentsTab } from './components/DeploymentsTab';
import { OperationsTab } from './components/OperationsTab';
import { QATab } from './components/QATab';
import { StudentsTab } from './components/StudentsTab';

const App: React.FC = () => {
  const { theme, toggleTheme } = useTheme();
  const [activeTab, setActiveTab] = useState<string | number>('upload');
  const [dryRun, setDryRun] = useState(true);
  const [schedules, setSchedules] = useState<WorkshopSchedule[]>([]);
  const [results, setResults] = useState<DeploymentResult[]>([]);
  const [qaResults, setQAResults] = useState<QAResult[]>([]);
  const [viewingSession, setViewingSession] = useState(false);
  const [toast, setToast] = useState<{ msg: string; variant: 'success' | 'danger' | 'info' } | null>(null);

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
    </Page>
  );
};

export default App;
