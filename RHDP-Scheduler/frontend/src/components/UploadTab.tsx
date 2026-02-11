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
  FileUpload,
  Modal,
  ModalBody,
  ModalHeader,
  ModalFooter,
} from '@patternfly/react-core';
import { Table, Thead, Tbody, Tr, Th, Td, ExpandableRowContent } from '@patternfly/react-table';
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

export const UploadTab: React.FC<Props> = ({
  dryRun, schedules, setSchedules, setResults, showToast, onClear,
}) => {
  const logRef = useRef<HTMLDivElement>(null);

  const [deploying, setDeploying] = useState(false);
  const [passwordCount, setPasswordCount] = useState<number | null>(null);
  const [progress, setProgress] = useState(0);
  const [progressMsg, setProgressMsg] = useState('');
  const [logLines, setLogLines] = useState<string[]>([]);

  // FileUpload state
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [csvFilename, setCsvFilename] = useState('');
  const [passwordFile, setPasswordFile] = useState<File | null>(null);
  const [passwordFilename, setPasswordFilename] = useState('');

  // Confirmation modal state
  const [showDeployConfirm, setShowDeployConfirm] = useState(false);
  const [showClearConfirm, setShowClearConfirm] = useState(false);

  // Expandable rows state
  const [expandedRows, setExpandedRows] = useState<Set<number>>(new Set());

  // auto-scroll log
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [logLines]);

  const toggleExpanded = (idx: number) => {
    setExpandedRows(prev => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx); else next.add(idx);
      return next;
    });
  };

  const handleUpload = async () => {
    if (!csvFile) { showToast('Please select a CSV file', 'danger'); return; }
    try {
      const data = await api.uploadCSV(csvFile);
      setSchedules(data.schedules);
      showToast(`Loaded ${data.count} schedule(s)`, 'success');
    } catch (e) {
      showToast(`Upload failed: ${e}`, 'danger');
    }
  };

  const handleUploadPasswords = async () => {
    if (!passwordFile) { showToast('Please select a passwords CSV file', 'danger'); return; }
    try {
      const data = await api.uploadPasswordsCSV(passwordFile);
      setPasswordCount(data.count);
      showToast(data.message, 'success');
    } catch (e) {
      showToast(`Password upload failed: ${e}`, 'danger');
    }
  };

  const handleClear = async () => {
    setShowClearConfirm(false);
    try {
      await api.clearSession();
      onClear();
      setLogLines([]);
      setProgress(0);
      setProgressMsg('');
      setPasswordCount(null);
      setCsvFile(null);
      setCsvFilename('');
      setPasswordFile(null);
      setPasswordFilename('');
      setExpandedRows(new Set());
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
    // If live deploy (not dry-run), require confirmation
    if (!dryRun && !showDeployConfirm) {
      setShowDeployConfirm(true);
      return;
    }
    setShowDeployConfirm(false);

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

  const columnCount = 10;

  return (
    <PageSection>
      {/* CSV Upload */}
      <Split hasGutter style={{ marginBottom: 16, alignItems: 'center' }}>
        <SplitItem isFilled>
          <FileUpload
            id="csv-file-upload"
            filename={csvFilename}
            filenamePlaceholder="Drag & drop or browse for a CSV file"
            browseButtonText="Browse"
            clearButtonText="Clear"
            onFileInputChange={(_e, file) => { setCsvFile(file); setCsvFilename(file.name); }}
            onClearClick={() => { setCsvFile(null); setCsvFilename(''); }}
            dropzoneProps={{ accept: { 'text/csv': ['.csv'] } }}
            hideDefaultPreview
          />
        </SplitItem>
        <SplitItem>
          <Button variant="primary" onClick={handleUpload}>Upload</Button>
        </SplitItem>
        <SplitItem>
          <Button variant="secondary" onClick={() => setShowClearConfirm(true)}>Clear / New Upload</Button>
        </SplitItem>
      </Split>

      {/* Passwords CSV upload */}
      <Split hasGutter style={{ marginBottom: 16, alignItems: 'center' }}>
        <SplitItem isFilled>
          <FileUpload
            id="password-file-upload"
            filename={passwordFilename}
            filenamePlaceholder="Drag & drop or browse for a passwords CSV"
            browseButtonText="Browse"
            clearButtonText="Clear"
            onFileInputChange={(_e, file) => { setPasswordFile(file); setPasswordFilename(file.name); }}
            onClearClick={() => { setPasswordFile(null); setPasswordFilename(''); }}
            dropzoneProps={{ accept: { 'text/csv': ['.csv'] } }}
            hideDefaultPreview
          />
        </SplitItem>
        <SplitItem>
          <Button variant="secondary" onClick={handleUploadPasswords}>Upload Passwords</Button>
        </SplitItem>
        {passwordCount !== null && (
          <SplitItem>
            <span>{passwordCount} asset password(s) loaded</span>
          </SplitItem>
        )}
      </Split>

      {/* Schedule preview */}
      {schedules.length > 0 ? (
        <>
          <Title headingLevel="h3" style={{ marginBottom: 8 }}>
            Schedule Preview ({schedules.length})
          </Title>
          <div style={{ marginBottom: 16 }}>
            <Table aria-label="Schedule preview" variant="compact" className="fixed-table">
              <Thead>
                <Tr>
                  <Th />
                  <Th width={10}>CI Name</Th>
                  <Th width={10}>CI</Th>
                  <Th width={10}>Workshop Name</Th>
                  <Th width={10}>Namespace</Th>
                  <Th width={10}>Users</Th>
                  <Th width={10}>Instances</Th>
                  <Th width={10}>UI</Th>
                  <Th width={10}>Prov. Date</Th>
                  <Th width={10}>Auto-Stop</Th>
                  <Th width={10}>Auto-Destroy</Th>
                </Tr>
              </Thead>
              <Tbody>
                {schedules.map((s, i) => (
                  <>
                    <Tr key={`row-${i}`}>
                      <Td
                        expand={{
                          rowIndex: i,
                          isExpanded: expandedRows.has(i),
                          onToggle: () => toggleExpanded(i),
                        }}
                      />
                      <Td dataLabel="CI Name">{s.ci_name}</Td>
                      <Td dataLabel="CI"><span className="cell-truncate" title={s.ci}>{s.ci}</span></Td>
                      <Td dataLabel="Workshop Name"><span className="cell-truncate" title={s.workshop_name}>{s.workshop_name}</span></Td>
                      <Td dataLabel="Namespace"><span className="cell-truncate" title={s.namespace}>{s.namespace}</span></Td>
                      <Td dataLabel="Users">{s.users ?? '-'}</Td>
                      <Td dataLabel="Instances">{s.instances ?? '-'}</Td>
                      <Td dataLabel="UI">{s.enable_workshop_interface ? 'Yes' : 'No'}</Td>
                      <Td dataLabel="Prov. Date">{s.provisioning_date}</Td>
                      <Td dataLabel="Auto-Stop">{s.auto_stop}</Td>
                      <Td dataLabel="Auto-Destroy">{s.auto_destroy}</Td>
                    </Tr>
                    {expandedRows.has(i) && (
                      <Tr key={`detail-${i}`} isExpanded>
                        <Td colSpan={columnCount + 1}>
                          <ExpandableRowContent>
                            <div className="schedule-detail-grid">
                              <div><strong>Password:</strong> {s.password || '-'}</div>
                              <div><strong>Activity:</strong> {s.activity || '-'}</div>
                              <div><strong>Purpose:</strong> {s.purpose || '-'}</div>
                              <div><strong>Salesforce IDs:</strong> {s.salesforce_ids || '-'}</div>
                              <div><strong>Concurrency:</strong> {s.concurrency ?? '-'}</div>
                              <div><strong>Multi-Asset:</strong> {s.is_multi_asset ? 'Yes' : 'No'}</div>
                              {s.is_multi_asset && (
                                <>
                                  <div><strong>Asset CIs:</strong> {s.asset_cis || '-'}</div>
                                  <div><strong>Multi Workshop Name:</strong> {s.multi_workshop_name || '-'}</div>
                                </>
                              )}
                            </div>
                          </ExpandableRowContent>
                        </Td>
                      </Tr>
                    )}
                  </>
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

      {/* Deploy confirmation modal (live mode only) */}
      <Modal
        variant="small"
        isOpen={showDeployConfirm}
        onClose={() => setShowDeployConfirm(false)}
        aria-labelledby="deploy-confirm-title"
      >
        <ModalHeader title="Confirm Live Deployment" labelId="deploy-confirm-title" titleIconVariant="warning" />
        <ModalBody>
          You are about to run a <strong>live deployment</strong> for {schedules.length} schedule(s).
          This will provision real resources. Are you sure?
        </ModalBody>
        <ModalFooter>
          <Button variant="danger" onClick={handleDeploy}>Deploy Now</Button>
          <Button variant="link" onClick={() => setShowDeployConfirm(false)}>Cancel</Button>
        </ModalFooter>
      </Modal>

      {/* Clear confirmation modal */}
      <Modal
        variant="small"
        isOpen={showClearConfirm}
        onClose={() => setShowClearConfirm(false)}
        aria-labelledby="clear-confirm-title"
      >
        <ModalHeader title="Confirm Clear Session" labelId="clear-confirm-title" />
        <ModalBody>
          This will archive the current session and reset all schedules, results, and logs. Continue?
        </ModalBody>
        <ModalFooter>
          <Button variant="primary" onClick={handleClear}>Clear Session</Button>
          <Button variant="link" onClick={() => setShowClearConfirm(false)}>Cancel</Button>
        </ModalFooter>
      </Modal>
    </PageSection>
  );
};
