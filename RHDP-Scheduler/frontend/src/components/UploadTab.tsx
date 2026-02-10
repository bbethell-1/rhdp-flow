import { useState, useRef, useEffect, useCallback } from 'react';
import {
  Button,
  PageSection,
  Title,
  Progress,
  Split,
  SplitItem,
  EmptyState,
  EmptyStateBody,
} from '@patternfly/react-core';
import { Table, Thead, Tbody, Tr, Th, Td } from '@patternfly/react-table';
import UploadIcon from '@patternfly/react-icons/dist/esm/icons/upload-icon';

import { api } from '../services/api';
import type { WorkshopSchedule, DeploymentResult } from '../types';

interface Props {
  dryRun: boolean;
  schedules: WorkshopSchedule[];
  setSchedules: (s: WorkshopSchedule[]) => void;
  results: DeploymentResult[];
  setResults: (r: DeploymentResult[]) => void;
  showToast: (msg: string, variant: 'success' | 'danger' | 'info') => void;
  onClear: () => void;
}

function truncate(s: string, n = 40) {
  return s && s.length > n ? s.slice(0, n) + '...' : s || '';
}

export const UploadTab: React.FC<Props> = ({
  dryRun, schedules, setSchedules, setResults, showToast, onClear,
}) => {
  const fileRef = useRef<HTMLInputElement>(null);
  const logRef = useRef<HTMLDivElement>(null);

  const [deploying, setDeploying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressMsg, setProgressMsg] = useState('');
  const [logLines, setLogLines] = useState<string[]>([]);

  // auto-scroll log
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [logLines]);

  const handleUpload = async () => {
    const file = fileRef.current?.files?.[0];
    if (!file) { showToast('Please select a CSV file', 'danger'); return; }
    try {
      const data = await api.uploadCSV(file);
      setSchedules(data.schedules);
      showToast(`Loaded ${data.count} schedule(s)`, 'success');
    } catch (e) {
      showToast(`Upload failed: ${e}`, 'danger');
    }
  };

  const handleClear = async () => {
    try {
      await api.clearSession();
      onClear();
      setLogLines([]);
      setProgress(0);
      setProgressMsg('');
      if (fileRef.current) fileRef.current.value = '';
      showToast('Session cleared', 'success');
    } catch (e) {
      showToast(`Clear failed: ${e}`, 'danger');
    }
  };

  const handleDryRun = async () => {
    if (schedules.length === 0) { showToast('Upload a CSV first', 'danger'); return; }
    try {
      const data = await api.dryRun({ dry_run: true });
      setResults(data);
      showToast(`Dry-run: ${data.length} result(s)`, 'success');
    } catch (e) {
      showToast(`Dry-run failed: ${e}`, 'danger');
    }
  };

  const appendLog = useCallback((line: string) => {
    setLogLines(prev => [...prev, line]);
  }, []);

  const handleDeploy = async () => {
    if (schedules.length === 0) { showToast('Upload a CSV first', 'danger'); return; }
    setDeploying(true);
    setProgress(0);
    setProgressMsg('Starting...');
    setLogLines([]);

    try {
      const job = await api.deploy({ dry_run: dryRun });
      const es = api.deployStream(job.job_id);

      es.addEventListener('status', (e: MessageEvent) => {
        const d = JSON.parse(e.data);
        setProgress(d.progress);
        setProgressMsg(d.message || '');
        if (d.message) appendLog(d.message);

        if (d.status === 'completed' || d.status === 'failed') {
          es.close();
          setDeploying(false);
          if (d.status === 'completed') {
            showToast('Deployment completed', 'success');
            api.deployResults().then(r => setResults(r)).catch(() => {});
          } else {
            showToast(`Deployment failed: ${d.error || 'unknown'}`, 'danger');
          }
        }
      });

      es.addEventListener('error', () => {
        es.close();
        setDeploying(false);
        showToast('Connection lost during deploy', 'danger');
      });
    } catch (e) {
      setDeploying(false);
      showToast(`Deploy failed: ${e}`, 'danger');
    }
  };

  return (
    <PageSection>
      {/* Upload controls */}
      <Split hasGutter style={{ marginBottom: 16, alignItems: 'center' }}>
        <SplitItem>
          <input type="file" accept=".csv" ref={fileRef} />
        </SplitItem>
        <SplitItem>
          <Button variant="primary" onClick={handleUpload}>Upload</Button>
        </SplitItem>
        <SplitItem>
          <Button variant="secondary" onClick={handleClear}>Clear / New Upload</Button>
        </SplitItem>
      </Split>

      {/* Schedule preview */}
      {schedules.length > 0 ? (
        <>
          <Title headingLevel="h3" style={{ marginBottom: 8 }}>
            Schedule Preview ({schedules.length})
          </Title>
          <div style={{ overflowX: 'auto', marginBottom: 16 }}>
            <Table aria-label="Schedule preview" variant="compact">
              <Thead>
                <Tr>
                  <Th>CI Name</Th>
                  <Th>CI</Th>
                  <Th>Namespace</Th>
                  <Th>Users</Th>
                  <Th>Workshop UI</Th>
                  <Th>Prov. Date</Th>
                  <Th>Auto-Stop</Th>
                  <Th>Auto-Destroy</Th>
                  <Th>Count</Th>
                </Tr>
              </Thead>
              <Tbody>
                {schedules.map((s, i) => (
                  <Tr key={i}>
                    <Td dataLabel="CI Name">{s.ci_name}</Td>
                    <Td dataLabel="CI"><span className="truncated" title={s.ci}>{truncate(s.ci)}</span></Td>
                    <Td dataLabel="Namespace">{s.namespace}</Td>
                    <Td dataLabel="Users">{s.users}</Td>
                    <Td dataLabel="Workshop UI">{s.enable_workshop_interface ? 'Yes' : 'No'}</Td>
                    <Td dataLabel="Prov. Date">{s.provisioning_date}</Td>
                    <Td dataLabel="Auto-Stop">{s.auto_stop}</Td>
                    <Td dataLabel="Auto-Destroy">{s.auto_destroy}</Td>
                    <Td dataLabel="Count">{s.count}</Td>
                  </Tr>
                ))}
              </Tbody>
            </Table>
          </div>

          {/* Deploy buttons */}
          <Split hasGutter style={{ marginBottom: 16 }}>
            <SplitItem>
              <Button variant="secondary" onClick={handleDryRun} isDisabled={deploying}>Dry-Run</Button>
            </SplitItem>
            <SplitItem>
              <Button variant="primary" onClick={handleDeploy} isDisabled={deploying} isDanger={!dryRun}>
                {dryRun ? 'Deploy (dry-run)' : 'Deploy'}
              </Button>
            </SplitItem>
          </Split>
        </>
      ) : (
        <EmptyState titleText="No schedules loaded" headingLevel="h3" icon={UploadIcon}>
          <EmptyStateBody>Upload a CSV file to preview and deploy workshop schedules.</EmptyStateBody>
        </EmptyState>
      )}

      {/* Progress */}
      {deploying && (
        <div style={{ marginBottom: 16 }}>
          <Progress value={progress} title={progressMsg} aria-label="Deploy progress" />
        </div>
      )}

      {/* Log */}
      {logLines.length > 0 && (
        <div className="log-box" ref={logRef}>
          {logLines.join('\n')}
        </div>
      )}
    </PageSection>
  );
};
