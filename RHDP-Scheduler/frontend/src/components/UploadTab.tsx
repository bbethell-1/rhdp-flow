import { useState, useRef, useEffect, useCallback, useMemo, Fragment } from 'react';
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
  SearchInput,
  Tooltip,
  TextInput,
} from '@patternfly/react-core';
import { Table, Thead, Tbody, Tr, Th, Td, ExpandableRowContent } from '@patternfly/react-table';
import UploadIcon from '@patternfly/react-icons/dist/esm/icons/upload-icon';
import TrashIcon from '@patternfly/react-icons/dist/esm/icons/trash-icon';

import { api } from '../services/api';
import { DiffView } from './DiffView';
import type { WorkshopSchedule, DeploymentResult, NumUsersViolation, UsersNotInCatalogAdvisory, ScheduleExampleMeta } from '../types';

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
    return new Date(Date.UTC(yr, parseInt(m[2]) - 1, parseInt(m[1]), parseInt(m[4]), parseInt(m[5])));
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
  setDeployLogFile?: (f: string | null) => void;
}

export const UploadTab: React.FC<Props> = ({
  dryRun, schedules, setSchedules, setResults, showToast, onClear, setDeployLogFile,
}) => {
  const logRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const jobIdRef = useRef<string | null>(null);

  // Clean up WebSocket on unmount
  useEffect(() => {
    return () => { wsRef.current?.close(); wsRef.current = null; };
  }, []);

  useEffect(() => {
    api.listScheduleExamples()
      .then(setScheduleExamples)
      .catch(() => setScheduleExamples([]));
  }, []);

  const [deploying, setDeploying] = useState(false);
  const [deployPaused, setDeployPaused] = useState(false);
  const [validating, setValidating] = useState(false);
  const [yamlDownloading, setYamlDownloading] = useState(false);
  const [rowEditsLocked, setRowEditsLocked] = useState(false);
  const [scheduleExamples, setScheduleExamples] = useState<ScheduleExampleMeta[]>([]);
  const [loadingExampleSlug, setLoadingExampleSlug] = useState<string | null>(null);
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
  const [showroomNovnc, setShowroomNovnc] = useState(false);
  const [showroomZerotouch, setShowroomZerotouch] = useState(false);

  // Namespace validation
  const [missingNamespaces, setMissingNamespaces] = useState<string[]>([]);

  // num_users limit validation
  const [numUsersViolations, setNumUsersViolations] = useState<NumUsersViolation[]>([]);
  const [usersNotInCatalog, setUsersNotInCatalog] = useState<UsersNotInCatalogAdvisory[]>([]);
  const [numUsersLimits, setNumUsersLimits] = useState<Record<string, number>>({});

  // Confirmation modal state
  const [showDeployConfirm, setShowDeployConfirm] = useState(false);
  const [showClearConfirm, setShowClearConfirm] = useState(false);

  // Expandable rows state
  const [expandedRows, setExpandedRows] = useState<Set<number>>(new Set());

  // Search filter for schedule preview
  const [previewSearch, setPreviewSearch] = useState('');

  // Skipped row tracking (CSV parse)
  const [skippedRows, setSkippedRows] = useState<number>(0);
  const [totalRows, setTotalRows] = useState<number>(0);

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

      // num_users catalog limit check
      if (s.users !== null && s.ci in numUsersLimits && s.users > numUsersLimits[s.ci])
        warns.push({ index: i, field: 'users', message: `"${s.ci_name}" exceeds catalog limit: ${s.users} users requested, max ${numUsersLimits[s.ci]}` });

      // Blank optional fields (informational)
      if (!s.password?.trim())
        warns.push({ index: i, field: 'password', message: `"${s.ci_name}" has no password set` });
      if (!s.activity?.trim())
        warns.push({ index: i, field: 'activity', message: `"${s.ci_name}" has a blank Activity field` });
      if (!s.purpose?.trim())
        warns.push({ index: i, field: 'purpose', message: `"${s.ci_name}" has a blank Purpose field` });
    });
    return warns;
  }, [schedules, numUsersLimits]);

  const warningRowIndices = useMemo(() => new Set(warnings.map(w => w.index)), [warnings]);

  // Filtered schedules for preview search
  const filteredSchedules = useMemo(() => {
    if (!previewSearch) return schedules.map((s, i) => ({ s, i }));
    const q = previewSearch.toLowerCase();
    return schedules
      .map((s, i) => ({ s, i }))
      .filter(({ s }) =>
        s.ci_name.toLowerCase().includes(q) ||
        s.ci.toLowerCase().includes(q) ||
        s.namespace.toLowerCase().includes(q) ||
        s.workshop_name.toLowerCase().includes(q)
      );
  }, [schedules, previewSearch]);
  const hasMultiAsset = schedules.some(s => s.is_multi_asset);
  const needsPasswordWarning = hasMultiAsset && passwordCount === null;

  // auto-scroll log
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [logLines]);

  /** Re-fetch namespace + catalog num_users checks from the server (uses loaded schedules). */
  const refreshClusterValidation = useCallback(async () => {
    setMissingNamespaces([]);
    setNumUsersViolations([]);
    setUsersNotInCatalog([]);
    setNumUsersLimits({});
    const [nsRes, nuRes] = await Promise.all([
      api.validateNamespaces(),
      api.validateNumUsers(),
    ]);
    if (nsRes.missing.length) setMissingNamespaces(nsRes.missing);
    if (nuRes.violations.length) setNumUsersViolations(nuRes.violations);
    if (nuRes.users_not_in_catalog?.length) setUsersNotInCatalog(nuRes.users_not_in_catalog);
    if (Object.keys(nuRes.limits).length) setNumUsersLimits(nuRes.limits);
    return { nsRes, nuRes };
  }, []);

  const handleValidate = async () => {
    if (schedules.length === 0) {
      showToast('Upload a CSV first', 'danger');
      return;
    }
    setValidating(true);
    try {
      const { nsRes, nuRes } = await refreshClusterValidation();
      const nNs = nsRes.missing.length;
      const nNu = nuRes.violations.length;
      const nAdv = nuRes.users_not_in_catalog?.length ?? 0;
      if (nNs === 0 && nNu === 0 && nAdv === 0) {
        showToast(
          'Validation passed: namespaces found on cluster; num_users within catalog limits where checked.',
          'success',
        );
      } else {
        showToast(
          `Validation: ${nNs} missing namespace(s), ${nNu} num_users over limit, ${nAdv} catalog/Users mismatch — see alerts below.`,
          'info',
        );
      }
    } catch (e) {
      showToast(`Validation failed: ${e}`, 'danger');
    } finally {
      setValidating(false);
    }
  };

  const handleDownloadYaml = async () => {
    if (schedules.length === 0) {
      showToast('Upload a CSV first', 'danger');
      return;
    }
    setYamlDownloading(true);
    try {
      await api.downloadDryRunYaml({
        dry_run: true,
        resource_lock: resourceLock,
        enable_resource_pools: enableResourcePools,
        white_glove: whiteGlove,
        redirect,
        showroom_novnc: showroomNovnc,
        showroom_zerotouch: showroomZerotouch,
      });
      showToast('Downloaded dry-run manifest YAML', 'success');
    } catch (e) {
      showToast(`YAML download failed: ${e}`, 'danger');
    } finally {
      setYamlDownloading(false);
    }
  };

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
      setSkippedRows(data.skipped_rows ?? 0);
      setTotalRows(data.total_rows ?? 0);
      const msg = data.skipped_rows
        ? `Loaded ${data.count} of ${data.total_rows} row(s) — ${data.skipped_rows} row(s) skipped`
        : `Loaded ${data.count} schedule(s)`;
      showToast(msg, data.skipped_rows ? 'danger' : 'success');
      try {
        await refreshClusterValidation();
      } catch (e) {
        console.warn('Post-upload cluster validation failed', e);
      }
    } catch (e) {
      showToast(`Upload failed: ${e}`, 'danger');
    }
  };

  const handleLoadExample = async (slug: string) => {
    setLoadingExampleSlug(slug);
    try {
      const data = await api.loadScheduleExample(slug);
      setSchedules(data.schedules);
      setSkippedRows(data.skipped_rows ?? 0);
      setTotalRows(data.total_rows ?? 0);
      const msg = data.skipped_rows
        ? `Loaded example ${data.count} of ${data.total_rows} row(s) — ${data.skipped_rows} skipped`
        : `Loaded example: ${data.count} schedule(s)`;
      showToast(msg, data.skipped_rows ? 'danger' : 'success');
      try {
        await refreshClusterValidation();
      } catch (e) {
        console.warn('Post-example cluster validation failed', e);
      }
    } catch (e) {
      showToast(`Example load failed: ${e}`, 'danger');
    } finally {
      setLoadingExampleSlug(null);
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
      setRedirect(true);
      setShowroomNovnc(false);
      setShowroomZerotouch(false);
      setNumUsersViolations([]);
      setNumUsersLimits({});
      showToast('Session cleared', 'success');
    } catch (e) {
      showToast(`Clear failed: ${e}`, 'danger');
    }
  };

  const handleDryRun = async () => {
    if (schedules.length === 0) { showToast('Upload a CSV first', 'danger'); return; }
    try {
      const data = await api.dryRun({ dry_run: true, resource_lock: resourceLock, enable_resource_pools: enableResourcePools, white_glove: whiteGlove, redirect, showroom_novnc: showroomNovnc, showroom_zerotouch: showroomZerotouch });
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
    if (!dryRun && !showDeployConfirm) {
      setShowDeployConfirm(true);
      return;
    }
    setShowDeployConfirm(false);

    if (schedules.length === 0) { showToast('Upload a CSV first', 'danger'); return; }
    if (!dryRun && numUsersViolations.length > 0) {
      showToast('Deploy blocked: one or more schedules exceed the catalog num_users limit', 'danger');
      return;
    }
    setDeploying(true);
    setDeployPaused(false);
    setProgress(0);
    setProgressMsg('Starting...');
    setLogLines([]);

    try {
      const job = await api.deploy({ dry_run: dryRun, resource_lock: resourceLock, enable_resource_pools: enableResourcePools, white_glove: whiteGlove, redirect, showroom_novnc: showroomNovnc, showroom_zerotouch: showroomZerotouch });
      jobIdRef.current = job.job_id;
      const ws = api.deployWebSocket(job.job_id);
      wsRef.current = ws;

      const handleStatus = (d: Record<string, unknown>) => {
        if (d.keepalive) return;
        setProgress(d.progress as number);
        setProgressMsg((d.message as string) || '');
        if (d.message) appendLog(d.message as string);
        if (d.status === 'paused') setDeployPaused(true);
        if (d.status === 'running') setDeployPaused(false);

        if (d.status === 'completed' || d.status === 'failed' || d.status === 'cancelled') {
          ws.close();
          wsRef.current = null;
          jobIdRef.current = null;
          setDeploying(false);
          setDeployPaused(false);
          if (d.log_file) setDeployLogFile?.(d.log_file as string);
          if (d.status === 'completed') {
            showToast('Deployment completed', 'success');
            api.deployResults().then(r => setResults(r)).catch((err) => { console.warn('Failed to fetch results', err); });
          } else if (d.status === 'cancelled') {
            showToast(`Deployment cancelled after ${d.progress}%`, 'info');
            api.deployResults().then(r => setResults(r)).catch(() => {});
          } else {
            showToast(`Deployment failed: ${d.error || 'unknown'}`, 'danger');
          }
        }
      };

      ws.onmessage = (e) => {
        try { handleStatus(JSON.parse(e.data)); } catch { /* ignore parse errors */ }
      };
      ws.onerror = () => {
        appendLog('WebSocket error — falling back to polling');
        ws.close();
        wsRef.current = null;
        const poll = setInterval(async () => {
          try {
            const s = await api.deployStatus(job.job_id);
            handleStatus(s as unknown as Record<string, unknown>);
            if (s.status === 'completed' || s.status === 'failed') clearInterval(poll);
          } catch { clearInterval(poll); setDeploying(false); }
        }, 2000);
      };
    } catch (e) {
      setDeploying(false);
      showToast(`Deploy failed: ${e}`, 'danger');
    }
  };

  const handleDeployCancel = () => {
    if (jobIdRef.current) {
      wsRef.current?.send(JSON.stringify({ command: 'cancel' }));
      api.deployCancel(jobIdRef.current).catch(() => {});
      appendLog('Cancel requested...');
    }
  };

  const handleDeployPause = () => {
    if (jobIdRef.current) {
      if (deployPaused) {
        wsRef.current?.send(JSON.stringify({ command: 'resume' }));
        api.deployResume(jobIdRef.current).catch(() => {});
        appendLog('Resuming...');
      } else {
        wsRef.current?.send(JSON.stringify({ command: 'pause' }));
        api.deployPause(jobIdRef.current).catch(() => {});
        appendLog('Pausing after current workshop...');
      }
    }
  };

  const columnCount = 12;

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
          <Split hasGutter style={{ marginBottom: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <SplitItem>
              <Title headingLevel="h3">
                Schedule Preview ({previewSearch ? `${filteredSchedules.length} of ${schedules.length}` : schedules.length})
              </Title>
            </SplitItem>
            <SplitItem isFilled />
            <SplitItem>
              <Tooltip content="When on, row dates, per-row redirect, and delete are disabled. Expand rows still works.">
                <Switch
                  id="schedule-row-edits-lock"
                  label="Lock row edits"
                  isChecked={rowEditsLocked}
                  onChange={(_e, c) => setRowEditsLocked(c)}
                  isReversed
                />
              </Tooltip>
            </SplitItem>
            <SplitItem>
              <SearchInput
                placeholder="Search schedules..."
                value={previewSearch}
                onChange={(_e, val) => setPreviewSearch(val)}
                onClear={() => setPreviewSearch('')}
                style={{ width: 220 }}
              />
            </SplitItem>
            <SplitItem>
              <Button variant="link" component="a" href={api.templateURL}>
                Download CSV Template
              </Button>
            </SplitItem>
            <SplitItem>
              <Tooltip content="Opens a new browser tab (#edit) with all CSV fields per row. Shares the same API session; use Save there, then reload this page to refresh the table.">
                <Button
                  variant="secondary"
                  onClick={() => {
                    const u = new URL(window.location.href);
                    u.hash = 'edit';
                    window.open(u.toString(), '_blank', 'noopener,noreferrer');
                  }}
                  isDisabled={schedules.length === 0}
                >
                  Full editor (new tab)
                </Button>
              </Tooltip>
            </SplitItem>
          </Split>
          {scheduleExamples.length > 0 && (
            <div style={{ marginBottom: 10, fontSize: '0.875rem', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '4px 8px' }}>
              <span style={{ color: 'var(--pf-v6-global--Color--200)' }}>Load example:</span>
              {scheduleExamples.map((ex) => (
                <Button
                  key={ex.slug}
                  variant="link"
                  isInline
                  isDisabled={!!loadingExampleSlug || deploying || validating || yamlDownloading}
                  isLoading={loadingExampleSlug === ex.slug}
                  onClick={() => handleLoadExample(ex.slug)}
                >
                  {ex.label}
                </Button>
              ))}
            </div>
          )}

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

          {/* num_users limit violations */}
          {numUsersViolations.length > 0 && (
            <Alert variant="danger" isInline title={`${numUsersViolations.length} schedule(s) exceed num_users limit`} style={{ marginBottom: 12 }}>
              <ul style={{ margin: '4px 0 0', paddingLeft: 20, fontSize: '0.85rem' }}>
                {numUsersViolations.map((v, i) => (
                  <li key={i}>
                    <strong>{v.ci_name}</strong> ({v.ci}): {v.requested_users} users requested, catalog max is {v.maximum}
                  </li>
                ))}
              </ul>
              Deployment will be blocked until user counts are reduced below the catalog limit.
            </Alert>
          )}

          {/* Catalog item has no num_users but CSV sets Users (e.g. use Instances for WorkshopProvision) */}
          {usersNotInCatalog.length > 0 && (
            <Alert
              variant={usersNotInCatalog.some(a => a.severity === 'high') ? 'warning' : 'info'}
              isInline
              title={`${usersNotInCatalog.length} row(s): Users set but catalog item has no num_users`}
              style={{ marginBottom: 12 }}
            >
              <ul style={{ margin: '4px 0 0', paddingLeft: 20, fontSize: '0.85rem' }}>
                {usersNotInCatalog.map((a, i) => (
                  <li key={i}>{a.message}</li>
                ))}
              </ul>
            </Alert>
          )}

          {/* Multi-asset password warning */}
          {needsPasswordWarning && (
            <Alert variant="warning" isInline title="Multi-asset passwords not loaded" style={{ marginBottom: 12 }}>
              Multi-asset workshop(s) detected but no password file uploaded. Each asset CI may need its own password.
              Upload a passwords CSV above to avoid deployment failures.
            </Alert>
          )}

          <Alert variant="info" isInline isPlain title="All schedule times are in UTC" style={{ marginBottom: 8 }}>
            Your local timezone: {Intl.DateTimeFormat().resolvedOptions().timeZone}. Ensure CSV dates are entered in UTC.
          </Alert>

          <div className="table-sticky-wrapper">
            <Table aria-label="Schedule preview" variant="compact" className="fixed-table" isStickyHeader>
              <Thead>
                <Tr>
                  <Th />
                  <Th>CI Name</Th>
                  <Th>CI</Th>
                  <Th>Workshop Name</Th>
                  <Th>Namespace</Th>
                  <Th>Users</Th>
                  <Th>Instances</Th>
                  <Th>UI</Th>
                  <Th>Redirect</Th>
                  <Th>Prov. Date (UTC)</Th>
                  <Th>Auto-Stop (UTC)</Th>
                  <Th>Auto-Destroy (UTC)</Th>
                  <Th>Actions</Th>
                </Tr>
              </Thead>
              <Tbody>
                {filteredSchedules.map(({ s, i }) => (
                  <Fragment key={`${s.ci}-${s.namespace}-${i}`}>
                    <Tr className={warningRowIndices.has(i) ? 'warning-row' : undefined}>
                      <Td
                        expand={{
                          rowIndex: i,
                          isExpanded: expandedRows.has(i),
                          onToggle: () => toggleExpanded(i),
                        }}
                      />
                      <Td dataLabel="CI Name">{s.ci_name}</Td>
                      <Td dataLabel="CI">{s.ci}</Td>
                      <Td dataLabel="Workshop Name">{s.workshop_name}</Td>
                      <Td dataLabel="Namespace">{s.namespace}</Td>
                      <Td dataLabel="Users">{s.users ?? '-'}</Td>
                      <Td dataLabel="Instances">{s.instances ?? '-'}</Td>
                      <Td dataLabel="UI">{s.enable_workshop_interface ? 'Yes' : 'No'}</Td>
                      <Td dataLabel="Redirect">
                        <Switch
                          id={`redirect-row-${i}`}
                          aria-label={`Redirect ${s.ci_name}`}
                          isChecked={s.redirect}
                          onChange={() => {
                            setSchedules(schedules.map((sc, idx) => idx === i ? { ...sc, redirect: !sc.redirect } : sc));
                          }}
                          isReversed
                          isDisabled={rowEditsLocked}
                        />
                      </Td>
                      <Td dataLabel="Prov. Date (UTC)" className="date-cell">
                        <TextInput
                          id={`prov-date-${i}`}
                          value={s.provisioning_date || ''}
                          onChange={(_e, value) => {
                            const updated = schedules.map((sc, idx) => idx === i ? { ...sc, provisioning_date: value } : sc);
                            setSchedules(updated);
                            // Update backend
                            api.updateSchedules(updated).catch(err => showToast(`Failed to update schedule: ${err}`, 'danger'));
                          }}
                          placeholder="DD/MM/YYYY HH:MM"
                          style={{ minWidth: '140px' }}
                          readOnly={rowEditsLocked}
                        />
                      </Td>
                      <Td dataLabel="Auto-Stop (UTC)" className="date-cell">
                        <TextInput
                          id={`auto-stop-${i}`}
                          value={s.auto_stop || ''}
                          onChange={(_e, value) => {
                            const updated = schedules.map((sc, idx) => idx === i ? { ...sc, auto_stop: value } : sc);
                            setSchedules(updated);
                            // Update backend
                            api.updateSchedules(updated).catch(err => showToast(`Failed to update schedule: ${err}`, 'danger'));
                          }}
                          placeholder="DD/MM/YYYY HH:MM"
                          style={{ minWidth: '140px' }}
                          readOnly={rowEditsLocked}
                        />
                      </Td>
                      <Td dataLabel="Auto-Destroy (UTC)" className="date-cell">
                        <TextInput
                          id={`auto-destroy-${i}`}
                          value={s.auto_destroy || ''}
                          onChange={(_e, value) => {
                            const updated = schedules.map((sc, idx) => idx === i ? { ...sc, auto_destroy: value } : sc);
                            setSchedules(updated);
                            // Update backend
                            api.updateSchedules(updated).catch(err => showToast(`Failed to update schedule: ${err}`, 'danger'));
                          }}
                          placeholder="DD/MM/YYYY HH:MM"
                          style={{ minWidth: '140px' }}
                          readOnly={rowEditsLocked}
                        />
                      </Td>
                      <Td dataLabel="Actions">
                        <Tooltip content="Delete this schedule">
                          <Button
                            variant="plain"
                            aria-label={`Delete ${s.ci_name}`}
                            isDisabled={rowEditsLocked}
                            onClick={async () => {
                              try {
                                await api.deleteSchedule(i);
                                const newSchedules = schedules.filter((_, idx) => idx !== i);
                                setSchedules(newSchedules);
                                showToast(`Deleted ${s.ci_name}`, 'info');
                              } catch (err) {
                                showToast(`Failed to delete schedule: ${err}`, 'danger');
                              }
                            }}
                          >
                            <TrashIcon />
                          </Button>
                        </Tooltip>
                      </Td>
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
                              {s.aws_regions && (() => {
                                const regions = s.aws_regions.split(',').map(r => r.trim()).filter(Boolean);
                                const total = s.users || 0;
                                const base = regions.length > 1 ? Math.floor(total / regions.length) : total;
                                const rem = regions.length > 1 ? total % regions.length : 0;
                                return (
                                  <div style={{ gridColumn: '1 / -1' }}>
                                    <strong>AWS Regions:</strong>{' '}
                                    {regions.map((r, idx) => {
                                      const count = base + (idx < rem ? 1 : 0);
                                      return <span key={r} style={{ marginRight: 12 }}>{r} ({count} users)</span>;
                                    })}
                                    {regions.length >= 2 && <em style={{ fontSize: '0.85em', opacity: 0.7 }}> — multi-region deploy</em>}
                                  </div>
                                );
                              })()}
                            </div>
                          </ExpandableRowContent>
                        </Td>
                      </Tr>
                    )}
                  </Fragment>
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
                  <Tooltip content="Prevents non-admin users from modifying resource settings in the RHDP UI. Sets the demo.redhat.com/lock-enabled label.">
                    <Switch
                      id="resource-lock-switch"
                      label="Lock UI Admin Settings"
                      isChecked={resourceLock}
                      onChange={(_e, checked) => setResourceLock(checked)}
                    />
                  </Tooltip>
                </SplitItem>
                <SplitItem>
                  <Tooltip content="Enable Poolboy resource pool allocation for flexible resource sharing across workshops. Leave off for dedicated per-workshop resources.">
                    <Switch
                      id="resource-pools-switch"
                      label="Enable Resource Pools"
                      isChecked={enableResourcePools}
                      onChange={(_e, checked) => setEnableResourcePools(checked)}
                    />
                  </Tooltip>
                </SplitItem>
                <SplitItem>
                  <Tooltip content="Mark workshops as fully managed and pre-configured. Applies the white-glove label for managed delivery.">
                    <Switch
                      id="white-glove-switch"
                      label="White Glove"
                      isChecked={whiteGlove}
                      onChange={(_e, checked) => setWhiteGlove(checked)}
                    />
                  </Tooltip>
                </SplitItem>
                <SplitItem>
                  <Tooltip content="Automatically redirect students to the lab UI after they log in to the workshop. Toggles all rows; override individual rows in the table.">
                    <Switch
                      id="redirect-switch"
                      label="Redirect (all)"
                      isChecked={redirect}
                      onChange={(_e, checked) => {
                        setRedirect(checked);
                        if (schedules.length > 0) {
                          setSchedules(schedules.map(s => ({ ...s, redirect: checked })));
                        }
                      }}
                    />
                  </Tooltip>
                </SplitItem>
              </Split>
              {schedules.some(s => s.showroom_repo) && (
                <Split hasGutter style={{ marginTop: 8 }}>
                  <SplitItem style={{ fontWeight: 600, fontSize: '0.85rem', alignSelf: 'center' }}>Showroom:</SplitItem>
                  <SplitItem>
                    <Tooltip content="Enable noVNC remote desktop tab in Showroom for Windows-based or graphical workshops.">
                      <Switch
                        id="showroom-novnc-switch"
                        label="noVNC Desktop"
                        isChecked={showroomNovnc}
                        onChange={(_e, checked) => setShowroomNovnc(checked)}
                      />
                    </Tooltip>
                  </SplitItem>
                  <SplitItem>
                    <Tooltip content="Use the zerotouch chart variant with setup and runtime automation containers for fully hands-off provisioning.">
                      <Switch
                        id="showroom-zerotouch-switch"
                        label="Zerotouch Automation"
                        isChecked={showroomZerotouch}
                        onChange={(_e, checked) => setShowroomZerotouch(checked)}
                      />
                    </Tooltip>
                  </SplitItem>
                </Split>
              )}
            </CardBody>
          </Card>

          {/* Deploy buttons */}
          <Split hasGutter style={{ marginBottom: 16, flexWrap: 'wrap' }}>
            <SplitItem>
              <Tooltip content="Check namespaces on the cluster and compare Users to each catalog item num_users maximum.">
                <Button variant="secondary" onClick={handleValidate} isDisabled={deploying || validating || yamlDownloading}>
                  {validating ? 'Validating…' : 'Validate'}
                </Button>
              </Tooltip>
            </SplitItem>
            <SplitItem>
              <Tooltip content="Simulate deploy and update results preview; no resources created.">
                <Button variant="secondary" onClick={handleDryRun} isDisabled={deploying || validating || yamlDownloading}>
                  Dry-run
                </Button>
              </Tooltip>
            </SplitItem>
            <SplitItem>
              <Tooltip content="Run dry-run and download ResourceClaim / Workshop / WorkshopProvision YAML (combined file).">
                <Button variant="secondary" onClick={handleDownloadYaml} isDisabled={deploying || validating || yamlDownloading}>
                  {yamlDownloading ? 'Preparing YAML…' : 'Download YAML'}
                </Button>
              </Tooltip>
            </SplitItem>
            <SplitItem>
              <Button variant="primary" onClick={handleDeploy} isDisabled={deploying || validating || yamlDownloading} isDanger={!dryRun}>
                {dryRun ? 'Deploy (dry-run)' : 'Deploy'}
              </Button>
            </SplitItem>
          </Split>

          {/* Diff view */}
          <DiffView hasSchedules={schedules.length > 0} showToast={showToast} />
        </>
      ) : (
        <EmptyState titleText="No schedules loaded" headingLevel="h3" icon={UploadIcon}>
          <EmptyStateBody>Upload a CSV file to preview and deploy workshop schedules.</EmptyStateBody>
        </EmptyState>
      )}

      {/* Progress + Cancel/Pause controls */}
      {deploying && (
        <div style={{ marginBottom: 16 }}>
          <Progress value={progress} title={progressMsg} aria-label="Deploy progress" />
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <Button variant="secondary" size="sm" onClick={handleDeployPause}>
              {deployPaused ? 'Resume' : 'Pause'}
            </Button>
            <Button variant="danger" size="sm" onClick={handleDeployCancel}>
              Cancel
            </Button>
          </div>
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
              {schedules.map((s) => (
                <li key={`${s.ci}-${s.namespace}`}>
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
