import { useState, useMemo, useCallback, useEffect } from 'react';
import {
  Alert,
  Button,
  Card,
  CardBody,
  CardTitle,
  Divider,
  PageSection,
  Switch,
  FormSelect,
  FormSelectOption,
  EmptyState,
  EmptyStateBody,
  SearchInput,
  Split,
  SplitItem,
  ToggleGroup,
  ToggleGroupItem,
  Tooltip,
  Flex,
  FlexItem,
} from '@patternfly/react-core';
import SearchIcon from '@patternfly/react-icons/dist/esm/icons/search-icon';
import CheckCircleIcon from '@patternfly/react-icons/dist/esm/icons/check-circle-icon';
import ExclamationCircleIcon from '@patternfly/react-icons/dist/esm/icons/exclamation-circle-icon';
import ExclamationTriangleIcon from '@patternfly/react-icons/dist/esm/icons/exclamation-triangle-icon';
import { useAutoRefresh } from '../hooks/useAutoRefresh';

import { api } from '../services/api';
import { AUTO_REFRESH_INTERVAL_MS, DEFAULT_PER_PAGE } from '../constants';
import type { QAResult } from '../types';
import { qaStatusCategory } from '../utils/statusColors';
import { QAResultsTable } from './QAResultsTable';
import { DestroyQASection } from './DestroyQASection';

interface Props {
  qaResults: QAResult[];
  setQAResults: (r: QAResult[]) => void;
  showToast: (msg: string, variant: 'success' | 'danger' | 'info') => void;
}

type SortableQAColumn = 'ci_name' | 'ci' | 'status' | 'namespace';

type QAStatusFilter = 'all' | 'success' | 'warning' | 'failed';

export const QATab: React.FC<Props> = ({ qaResults, setQAResults, showToast }) => {
  const [qaType, setQaType] = useState<'1' | '2' | 'both'>('both');
  const [running, setRunning] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(DEFAULT_PER_PAGE);
  const [sortBy, setSortBy] = useState<SortableQAColumn | null>('ci_name');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [qaSearch, setQaSearch] = useState('');
  const [qaStatusFilter, setQaStatusFilter] = useState<QAStatusFilter>('all');
  const [namespaces, setNamespaces] = useState<string[]>([]);
  const [selectedNamespace, setSelectedNamespace] = useState<string>('');

  useEffect(() => {
    api.qaNamespaces().then(setNamespaces).catch(() => {});
  }, []);

  const refreshQA = useCallback(async () => {
    try {
      const data = await api.qaResults();
      setQAResults(data.results);
    } catch (e) { console.warn('Auto-refresh QA results failed', e); }
  }, [setQAResults]);

  useAutoRefresh(refreshQA, AUTO_REFRESH_INTERVAL_MS, autoRefresh);

  const handleRun = async () => {
    setRunning(true);
    try {
      const data = await api.runQA({
        type: qaType,
        namespace: selectedNamespace || undefined,
      });
      setQAResults(data.results);
      showToast(`QA complete: ${data.count} result(s)`, 'success');
    } catch (e) {
      showToast(`QA failed: ${e}`, 'danger');
    } finally {
      setRunning(false);
    }
  };

  const handleRefresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      const data = await api.qaResults();
      setQAResults(data.results);
      showToast(`Refreshed: ${data.count} QA result(s)`, 'success');
    } catch (e) {
      showToast(`Refresh failed: ${e}`, 'danger');
    } finally {
      setRefreshing(false);
    }
  };

  // --- Summary counts ---
  const summary = useMemo(() => {
    let success = 0, warning = 0, danger = 0;
    for (const r of qaResults) {
      const cat = qaStatusCategory(r.status);
      if (cat === 'success') success++;
      else if (cat === 'warning') warning++;
      else danger++;
    }
    return { total: qaResults.length, success, warning, danger };
  }, [qaResults]);

  // --- Filtering ---
  const filteredQAResults = useMemo(() => {
    let filtered = qaResults;
    if (qaStatusFilter !== 'all') {
      filtered = filtered.filter(r => {
        const cat = qaStatusCategory(r.status);
        if (qaStatusFilter === 'success') return cat === 'success';
        if (qaStatusFilter === 'warning') return cat === 'warning';
        return cat === 'danger' || cat === 'unknown';
      });
    }
    if (qaSearch) {
      const q = qaSearch.toLowerCase();
      filtered = filtered.filter(r =>
        r.ci_name.toLowerCase().includes(q) ||
        r.ci.toLowerCase().includes(q) ||
        (r.namespace || '').toLowerCase().includes(q) ||
        (r.status || '').toLowerCase().includes(q)
      );
    }
    return filtered;
  }, [qaResults, qaStatusFilter, qaSearch]);

  const isQAFiltered = qaStatusFilter !== 'all' || qaSearch.length > 0;
  const qaTitle = isQAFiltered
    ? `QA Results (${filteredQAResults.length} of ${qaResults.length})`
    : `QA Results (${qaResults.length})`;

  const handleDownloadFilteredCSV = () => {
    const headers = ['CI Name', 'Namespace', 'CI', 'Status', 'Deployed', 'Healthy', 'Expected Seats', 'Actual Seats', 'Issues', 'Landing Page URL'];
    const rows = filteredQAResults.map(r => {
      const rec = r as QAResult & { expected_seats?: unknown; actual_seats?: unknown; actual_users?: unknown };
      const deployedYes = String(r.deployed || '').trim().toLowerCase() === 'yes';
      const expRaw = rec.expected_users ?? rec.expected_seats;
      const expCsv = expRaw === null || expRaw === undefined || expRaw === '' ? '' : String(expRaw);
      let actCsv = '';
      if (deployedYes) {
        const a = rec.actual_count ?? rec.actual_seats ?? rec.actual_users;
        actCsv = a === null || a === undefined || a === '' ? '' : String(a);
      }
      return [
        r.ci_name, r.namespace || '', r.ci, r.status, r.deployed,
        String(r.healthy ?? ''), expCsv, actCsv,
        String(r.issues ?? ''),
        r.landing_page_url || '',
      ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(',');
    });
    const csv = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `qa-results-${qaStatusFilter}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <PageSection>
      <Alert variant="info" isInline isPlain title="When to use QA" style={{ marginBottom: 16 }}>
        Run QA checks after deploying workshops to verify they were created correctly and are healthy.
        <strong> QA1</strong> verifies configuration immediately after deployment.
        <strong> QA2</strong> checks health and collects student landing page URLs (run 10-30 min after deploy).
      </Alert>

      {/* Controls row */}
      <Split hasGutter style={{ marginBottom: 16, alignItems: 'flex-end' }}>
        <SplitItem>
          <div style={{ fontSize: '0.8rem', fontWeight: 600, marginBottom: 4 }}>QA Type</div>
          <FormSelect
            value={qaType}
            onChange={(_e, val) => setQaType(val as '1' | '2' | 'both')}
            aria-label="QA type"
            className="qa-type-select"
            style={{ width: 200 }}
          >
            <FormSelectOption value="1" label="QA1 - Verify Setup" />
            <FormSelectOption value="2" label="QA2 - Deployment" />
            <FormSelectOption value="both" label="Both (recommended)" />
          </FormSelect>
        </SplitItem>
        {namespaces.length > 1 && (
          <SplitItem>
            <div style={{ fontSize: '0.8rem', fontWeight: 600, marginBottom: 4 }}>Namespace</div>
            <FormSelect
              value={selectedNamespace}
              onChange={(_e, val) => setSelectedNamespace(val)}
              aria-label="QA namespace"
              style={{ width: 240 }}
            >
              <FormSelectOption value="" label={`All namespaces (${namespaces.length})`} />
              {namespaces.map(ns => (
                <FormSelectOption key={ns} value={ns} label={ns} />
              ))}
            </FormSelect>
          </SplitItem>
        )}
        <SplitItem>
          <Button variant="primary" onClick={handleRun} isDisabled={running} isLoading={running} style={{ marginTop: 20 }}>
            Run QA
          </Button>
        </SplitItem>
        <SplitItem>
          <Button variant="secondary" onClick={handleRefresh} isLoading={refreshing} isDisabled={refreshing} style={{ marginTop: 20 }}>
            Refresh
          </Button>
        </SplitItem>
        <SplitItem isFilled />
        <SplitItem>
          <Tooltip content="Automatically poll for updated QA results every 15 seconds">
            <Switch
              id="qa-auto-refresh"
              label="Auto-refresh"
              isChecked={autoRefresh}
              onChange={(_e, checked) => setAutoRefresh(checked)}
            />
          </Tooltip>
        </SplitItem>
      </Split>

      {/* QA type hint */}
      <p className="qa-type-hint" style={{ marginBottom: 16, fontSize: '0.85rem', opacity: 0.7 }}>
        {qaType === '1' && 'Compares live workshops against your CSV schedule — checks dates, user counts, and configuration.'}
        {qaType === '2' && 'Checks that workshops are provisioned, healthy, verifies seat counts, and retrieves student URLs.'}
        {qaType === 'both' && 'Runs setup verification then deployment checks; shows one merged row per workshop.'}
      </p>

      {/* Summary cards */}
      {qaResults.length > 0 && (
        <Flex style={{ marginBottom: 16, gap: 12 }}>
          <FlexItem>
            <Card isCompact style={{ minWidth: 120, textAlign: 'center' }}>
              <CardBody style={{ padding: '12px 16px' }}>
                <div style={{ fontSize: '1.5rem', fontWeight: 700 }}>{summary.total}</div>
                <div style={{ fontSize: '0.8rem', opacity: 0.7 }}>Total</div>
              </CardBody>
            </Card>
          </FlexItem>
          <FlexItem>
            <Card isCompact style={{ minWidth: 120, textAlign: 'center', borderLeft: '3px solid var(--pf-t--global--color--status--success--default)' }}>
              <CardBody style={{ padding: '12px 16px' }}>
                <div style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--pf-t--global--color--status--success--default)' }}>
                  <CheckCircleIcon style={{ marginRight: 4, verticalAlign: 'middle' }} />{summary.success}
                </div>
                <div style={{ fontSize: '0.8rem', opacity: 0.7 }}>Passed</div>
              </CardBody>
            </Card>
          </FlexItem>
          {summary.warning > 0 && (
            <FlexItem>
              <Card isCompact style={{ minWidth: 120, textAlign: 'center', borderLeft: '3px solid var(--pf-t--global--color--status--warning--default)' }}>
                <CardBody style={{ padding: '12px 16px' }}>
                  <div style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--pf-t--global--color--status--warning--default)' }}>
                    <ExclamationTriangleIcon style={{ marginRight: 4, verticalAlign: 'middle' }} />{summary.warning}
                  </div>
                  <div style={{ fontSize: '0.8rem', opacity: 0.7 }}>Warning</div>
                </CardBody>
              </Card>
            </FlexItem>
          )}
          {summary.danger > 0 && (
            <FlexItem>
              <Card isCompact style={{ minWidth: 120, textAlign: 'center', borderLeft: '3px solid var(--pf-t--global--color--status--danger--default)' }}>
                <CardBody style={{ padding: '12px 16px' }}>
                  <div style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--pf-t--global--color--status--danger--default)' }}>
                    <ExclamationCircleIcon style={{ marginRight: 4, verticalAlign: 'middle' }} />{summary.danger}
                  </div>
                  <div style={{ fontSize: '0.8rem', opacity: 0.7 }}>Failed</div>
                </CardBody>
              </Card>
            </FlexItem>
          )}
        </Flex>
      )}

      {/* Toolbar: search + filter + CSV download */}
      {qaResults.length > 0 && (
        <Split hasGutter style={{ marginBottom: 16, alignItems: 'center' }}>
          <SplitItem>
            <Button variant="secondary" onClick={handleDownloadFilteredCSV} isDisabled={filteredQAResults.length === 0}>
              Download{isQAFiltered ? ' Filtered' : ''} CSV
            </Button>
          </SplitItem>
          <SplitItem isFilled />
          <SplitItem>
            <SearchInput
              placeholder="Search workshop, CI, namespace..."
              value={qaSearch}
              onChange={(_e, val) => { setQaSearch(val); setPage(1); }}
              onClear={() => { setQaSearch(''); setPage(1); }}
              style={{ width: 250 }}
            />
          </SplitItem>
          <SplitItem>
            <ToggleGroup aria-label="QA status filter">
              <ToggleGroupItem buttonId="qa-filter-all" text="All" isSelected={qaStatusFilter === 'all'} onChange={() => { setQaStatusFilter('all'); setPage(1); }} />
              <ToggleGroupItem buttonId="qa-filter-success" text={`Passed${summary.success ? ` (${summary.success})` : ''}`} isSelected={qaStatusFilter === 'success'} onChange={() => { setQaStatusFilter('success'); setPage(1); }} />
              {summary.warning > 0 && (
                <ToggleGroupItem buttonId="qa-filter-warning" text={`Warning (${summary.warning})`} isSelected={qaStatusFilter === 'warning'} onChange={() => { setQaStatusFilter('warning'); setPage(1); }} />
              )}
              <ToggleGroupItem buttonId="qa-filter-failed" text={`Failed${summary.danger ? ` (${summary.danger})` : ''}`} isSelected={qaStatusFilter === 'failed'} onChange={() => { setQaStatusFilter('failed'); setPage(1); }} />
            </ToggleGroup>
          </SplitItem>
        </Split>
      )}

      {/* Empty state: QA type explanation cards */}
      {qaResults.length === 0 && (
        <div className="ops-grid" style={{ marginBottom: 16 }}>
          <Card isCompact>
            <CardTitle>QA1 — Verify Setup</CardTitle>
            <CardBody style={{ fontSize: '0.85rem' }}>
              <p><strong>When:</strong> Immediately after deploying workshops.</p>
              <p><strong>What it checks:</strong></p>
              <ul style={{ margin: '4px 0 0', paddingLeft: 20 }}>
                <li>Workshop resources exist in the namespace</li>
                <li>Provisioning dates, auto-stop, and auto-destroy match the CSV</li>
                <li>User/seat counts match what was scheduled</li>
                <li>Workshop interface (UI) is enabled/disabled correctly</li>
              </ul>
              <p style={{ marginTop: 8 }}><strong>Result:</strong> Each workshop shows <span className="status-verified">verified</span> or <span className="status-failed">failed</span> with details on what mismatched.</p>
            </CardBody>
          </Card>
          <Card isCompact>
            <CardTitle>QA2 — Verify Deployment</CardTitle>
            <CardBody style={{ fontSize: '0.85rem' }}>
              <p><strong>When:</strong> 10-30 minutes after deployment, once workshops have provisioned.</p>
              <p><strong>What it checks:</strong></p>
              <ul style={{ margin: '4px 0 0', paddingLeft: 20 }}>
                <li>Workshops are actually deployed and running</li>
                <li>Health status of each workshop instance</li>
                <li>Expected vs actual seat counts</li>
                <li>Student landing page URLs are available</li>
              </ul>
              <p style={{ marginTop: 8 }}><strong>Result:</strong> Landing page URLs appear in the <strong>Students</strong> tab for distribution.</p>
            </CardBody>
          </Card>
        </div>
      )}

      {/* QA results table */}
      {qaResults.length > 0 ? (
        <QAResultsTable
          qaResults={filteredQAResults}
          title={qaTitle}
          page={page}
          setPage={setPage}
          perPage={perPage}
          setPerPage={setPerPage}
          sortBy={sortBy}
          setSortBy={setSortBy}
          sortDir={sortDir}
          setSortDir={setSortDir}
        />
      ) : (
        <EmptyState titleText="No QA results yet" headingLevel="h3" icon={SearchIcon}>
          <EmptyStateBody>Select a QA type above and click Run QA after deploying your workshops.</EmptyStateBody>
        </EmptyState>
      )}

      <Divider style={{ margin: '24px 0' }} />
      <DestroyQASection showToast={showToast} />
    </PageSection>
  );
};
