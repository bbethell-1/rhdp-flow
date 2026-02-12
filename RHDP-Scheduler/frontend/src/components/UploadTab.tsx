import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import {
  Alert,
  Button,
  Card,
  CardBody,
  CardTitle,
  PageSection,
  Title,
  Progress,
  Split,
  SplitItem,
  Switch,
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

/* ── Schedule date validation helpers ── */

interface ScheduleWarning {
  index: number;
  field: string;
  message: string;
}

/** Parse DD/MM/YYYY HH:MM (or DD/MM/YY HH:MM) into a Date, or null. */
function parseScheduleDate(dateStr: string): Date | null {
  if (!dateStr?.trim()) return null;
  const m = dateStr.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})\s+(\d{1,2}):(\d{2})$/);
  if (m) {
    const yr = m[3].length === 2 ? 2000 + parseInt(m[3]) : parseInt(m[3]);
    return new Date(yr, parseInt(m[2]) - 1, parseInt(m[1]), parseInt(m[4]), parseInt(m[5]));
  }
  const d = new Date(dateStr);
  return isNaN(d.getTime()) ? null : d;
}

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

  // Deploy settings
  const [resourceLock, setResourceLock] = useState(true);
  const [enableResourcePools, setEnableResourcePools] = useState(false);
  const [whiteGlove, setWhiteGlove] = useState(true);
  const [redirect, setRedirect] = useState(true);

  // Namespace validation
  const [missingNamespaces, setMissingNamespaces] = useState<string[]>([]);

  // Confirmation modal state
  const [showDeployConfirm, setShowDeployConfirm] = useState(false);
  const [showClearConfirm, setShowClearConfirm] = useState(false);

  // Expandable rows state
  const [expandedRows, setExpandedRows] = useState<Set<number>>(new Set());

  // ── Schedule validation warnings ──
  const warnings = useMemo(() => {
    const warns: ScheduleWarning[] = [];
    const now = new Date();

    // Detect duplicate rows (same CI + Namespace)
    const seen = new Map<string, number>();
    schedules.forEach((s, i) => {
      const key = `${s.ci}||${s.namespace}`;
      if (seen.has(key) && !s.multi_workshop_name) {
        warns.push({ index: i, field: 'ci', message: `"${s.ci_name}" appears to be a duplicate (same CI + Namespace as row ${(seen.get(key) ?? 0) + 1})` });
      } else {
        seen.set(key, i);
      }
    });

    schedules.forEach((s, i) => {
      const prov = parseScheduleDate(s.provisioning_date);
      const stop = parseScheduleDate(s.auto_stop);
      const destroy = parseScheduleDate(s.auto_destroy);

      // Unparseable dates
      if (s.provisioning_date && !prov)
        warns.push({ index: i, field: 'provisioning_date', message: `"${s.ci_name}" has an unparseable provisioning date: "${s.provisioning_date}"` });
      if (s.auto_stop && !stop)
        warns.push({ index: i, field: 'auto_stop', message: `"${s.ci_name}" has an unparseable auto-stop date: "${s.auto_stop}"` });
      if (s.auto_destroy && !destroy)
        warns.push({ index: i, field: 'auto_destroy', message: `"${s.ci_name}" has an unparseable auto-destroy date: "${s.auto_destroy}"` });

      // Past provisioning date
      if (prov && prov < now)
        warns.push({ index: i, field: 'provisioning_date', message: `"${s.ci_name}" provisioning date is in the past (${s.provisioning_date})` });

      // Auto-stop before provisioning
      if (prov && stop && stop <= prov)
        warns.push({ index: i, field: 'auto_stop', message: `"${s.ci_name}" auto-stop is before or equal to provisioning date` });

      // Missing required dates
      if (!s.provisioning_date?.trim())
        warns.push({ index: i, field: 'provisioning_date', message: `"${s.ci_name}" is missing a provisioning date` });
      if (!s.auto_stop?.trim())
        warns.push({ index: i, field: 'auto_stop', message: `"${s.ci_name}" is missing an auto-stop date` });
      if (!s.auto_destroy?.trim())
        warns.push({ index: i, field: 'auto_destroy', message: `"${s.ci_name}" is missing an auto-destroy date` });

      // CI format check (expect vendor.item.env pattern)
      if (s.ci && !s.ci.includes('.'))
        warns.push({ index: i, field: 'ci', message: `"${s.ci_name}" CI "${s.ci}" may be invalid (expected format: vendor.item.env)` });

      // Namespace format check
      if (s.namespace && !/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(s.namespace))
        warns.push({ index: i, field: 'namespace', message: `"${s.ci_name}" namespace "${s.namespace}" may be invalid (must be lowercase alphanumeric with hyphens)` });

      // Users reasonableness
      if (s.users !== null && s.users > 500)
        warns.push({ index: i, field: 'users', message: `"${s.ci_name}" has a high user count (${s.users}) — verify this is intentional` });
      if (s.users !== null && s.users < 1)
        warns.push({ index: i, field: 'users', message: `"${s.ci_name}" has an invalid user count (${s.users})` });

      // Blank optional fields (informational)
      if (!s.password?.trim())
        warns.push({ index: i, field: 'password', message: `"${s.ci_name}" has no password set` });
      if (!s.activity?.trim())
        warns.push({ index: i, field: 'activity', message: `"${s.ci_name}" has a blank Activity field` });
      if (!s.purpose?.trim())
        warns.push({ index: i, field: 'purpose', message: `"${s.ci_name}" has a blank Purpose field` });
    });
    return warns;
  }, [schedules]);

  const warningRowIndices = useMemo(() => new Set(warnings.map(w => w.index)), [warnings]);
  const hasMultiAsset = schedules.some(s => s.is_multi_asset);
  const needsPasswordWarning = hasMultiAsset && passwordCount === null;

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

  // Skipped row tracking
  const [skippedRows, setSkippedRows] = useState<number>(0);
  const [totalRows, setTotalRows] = useState<number>(0);

  const handleUpload = async () => {
    if (!csvFile) { showToast('Please select a CSV file', 'danger'); return; }
    try {
      const data = await api.uploadCSV(csvFile);
      setSchedules(data.schedules);
      setSkippedRows(data.skipped_rows ?? 0);
      setTotalRows(data.total_rows ?? 0);
      const msg = data.skipped_rows
        ? `Loaded ${data.count} of ${data.total_rows} row(s) — ${data.skipped_rows} row(s) skipped`
        : `Loaded ${data.count} schedule(s)`;
      showToast(msg, data.skipped_rows ? 'danger' : 'success');
      // Validate namespaces in background
      setMissingNamespaces([]);
      api.validateNamespaces()
        .then(r => { if (r.missing.length) setMissingNamespaces(r.missing); })
        .catch(() => { /* cluster may be unreachable — skip silently */ });
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
      setSkippedRows(0);
      setTotalRows(0);
      setResourceLock(true);
      setEnableResourcePools(false);
      setWhiteGlove(true);
      showToast('Session cleared', 'success');
    } catch (e) {
      showToast(`Clear failed: ${e}`, 'danger');
    }
  };

  const handleDryRun = async () => {
    if (schedules.length === 0) { showToast('Upload a CSV first', 'danger'); return; }
    try {
      const data = await api.dryRun({ dry_run: true, resource_lock: resourceLock, enable_resource_pools: enableResourcePools, white_glove: whiteGlove, redirect });
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
      const job = await api.deploy({ dry_run: dryRun, resource_lock: resourceLock, enable_resource_pools: enableResourcePools, white_glove: whiteGlove, redirect });
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

          {/* Skipped rows warning */}
          {skippedRows > 0 && (
            <Alert variant="danger" isInline title={`${skippedRows} of ${totalRows} CSV row(s) were skipped`} style={{ marginBottom: 12 }}>
              Some rows could not be parsed (bad values in Users, Instances, Concurrency, or missing required fields).
              Review the source CSV and re-upload.
            </Alert>
          )}

          {/* Validation warnings */}
          {warnings.length > 0 && (
            <Alert variant="warning" isInline title={`${warnings.length} validation warning(s) — review before deploying`} style={{ marginBottom: 12 }}>
              <ul style={{ margin: '4px 0 0', paddingLeft: 20, fontSize: '0.85rem' }}>
                {warnings.map((w, i) => <li key={i}>{w.message}</li>)}
              </ul>
            </Alert>
          )}

          {/* Namespace existence warning */}
          {missingNamespaces.length > 0 && (
            <Alert variant="danger" isInline title={`${missingNamespaces.length} namespace(s) not found on cluster`} style={{ marginBottom: 12 }}>
              The following namespaces do not exist: <strong>{missingNamespaces.join(', ')}</strong>.
              Deployment will fail unless these are created first.
            </Alert>
          )}

          {/* Multi-asset password warning */}
          {needsPasswordWarning && (
            <Alert variant="warning" isInline title="Multi-asset passwords not loaded" style={{ marginBottom: 12 }}>
              Multi-asset workshop(s) detected but no password file uploaded. Each asset CI may need its own password.
              Upload a passwords CSV above to avoid deployment failures.
            </Alert>
          )}

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
                    <Tr key={`row-${i}`} className={warningRowIndices.has(i) ? 'warning-row' : undefined}>
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

          {/* Deploy settings */}
          <Card isCompact style={{ marginBottom: 16 }}>
            <CardTitle>Deploy Settings</CardTitle>
            <CardBody>
              <Split hasGutter>
                <SplitItem>
                  <Switch
                    id="resource-lock-switch"
                    label="Resource Lock"
                    isChecked={resourceLock}
                    onChange={(_e, checked) => setResourceLock(checked)}
                  />
                </SplitItem>
                <SplitItem>
                  <Switch
                    id="resource-pools-switch"
                    label="Enable Resource Pools"
                    isChecked={enableResourcePools}
                    onChange={(_e, checked) => setEnableResourcePools(checked)}
                  />
                </SplitItem>
                <SplitItem>
                  <Switch
                    id="white-glove-switch"
                    label="White Glove"
                    isChecked={whiteGlove}
                    onChange={(_e, checked) => setWhiteGlove(checked)}
                  />
                </SplitItem>
                <SplitItem>
                  <Switch
                    id="redirect-switch"
                    label="Redirect"
                    isChecked={redirect}
                    onChange={(_e, checked) => setRedirect(checked)}
                  />
                </SplitItem>
              </Split>
            </CardBody>
          </Card>

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
          <p>
            You are about to run a <strong>live deployment</strong> for {schedules.length} schedule(s).
            This will provision real resources.
          </p>
          {warnings.length > 0 && (
            <Alert variant="warning" isInline isPlain title={`${warnings.length} unresolved warning(s)`} style={{ margin: '12px 0' }}>
              Review the warnings on the schedule preview before deploying.
            </Alert>
          )}
          <div style={{ marginTop: 12, fontSize: '0.85rem', maxHeight: 200, overflowY: 'auto' }}>
            <strong>Schedules to deploy:</strong>
            <ul style={{ margin: '4px 0 0', paddingLeft: 20 }}>
              {schedules.map((s, i) => (
                <li key={i}>
                  <strong>{s.ci_name}</strong> — {s.ci} in {s.namespace}
                  {s.instances != null && ` (${s.instances} instances)`}
                  {s.users != null && ` (${s.users} users)`}
                  {s.is_multi_asset && ' [multi-asset]'}
                </li>
              ))}
            </ul>
          </div>
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
