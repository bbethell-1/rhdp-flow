import { useState, useMemo, useCallback } from 'react';
import {
  Alert,
  Button,
  Card,
  CardBody,
  CardTitle,
  Divider,
  PageSection,
  Label,
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
  FileUpload,
} from '@patternfly/react-core';
import SearchIcon from '@patternfly/react-icons/dist/esm/icons/search-icon';
import { useAutoRefresh } from '../hooks/useAutoRefresh';

import { api } from '../services/api';
import { AUTO_REFRESH_INTERVAL_MS, DEFAULT_PER_PAGE } from '../constants';
import type { QAResult } from '../types';
import { QAResultsTable } from './QAResultsTable';
import { DestroyQASection } from './DestroyQASection';

interface Props {
  qaResults: QAResult[];
  setQAResults: (r: QAResult[]) => void;
  showToast: (msg: string, variant: 'success' | 'danger' | 'info') => void;
}

type SortableQAColumn = 'ci_name' | 'ci' | 'status';

type QAStatusFilter = 'all' | 'verified' | 'failed';

export const QATab: React.FC<Props> = ({ qaResults, setQAResults, showToast }) => {
  const [qaType, setQaType] = useState<'1' | '2' | 'both'>('both');
  const [running, setRunning] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [groupByNamespace, setGroupByNamespace] = useState(false);
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [csvUploading, setCsvUploading] = useState(false);
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(DEFAULT_PER_PAGE);
  const [sortBy, setSortBy] = useState<SortableQAColumn | null>('ci_name');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [qaSearch, setQaSearch] = useState('');
  const [qaStatusFilter, setQaStatusFilter] = useState<QAStatusFilter>('all');

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
      const data = await api.runQA({ type: qaType });
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

  const handleCsvUpload = async (file: File | null) => {
    if (!file) {
      setCsvFile(null);
      return;
    }
    setCsvFile(file);
    setCsvUploading(true);
    try {
      // Parse CSV to extract namespaces
      const text = await file.text();
      const lines = text.split('\n').filter(l => l.trim());
      if (lines.length < 2) {
        showToast('CSV must have header and at least one row', 'danger');
        setCsvUploading(false);
        return;
      }
      const headers = lines[0].toLowerCase().split(',').map(h => h.trim());
      const nsIdx = headers.indexOf('namespace');
      if (nsIdx === -1) {
        showToast('CSV must have a "Namespace" column', 'danger');
        setCsvUploading(false);
        return;
      }
      const namespaces = Array.from(new Set(
        lines.slice(1).map(line => {
          const cells = line.split(',');
          return cells[nsIdx]?.trim();
        }).filter(ns => ns && ns.length > 0)
      ));

      if (namespaces.length === 0) {
        showToast('No valid namespaces found in CSV', 'danger');
        setCsvUploading(false);
        return;
      }

      // Run QA against extracted namespaces
      const data = await api.runQA({ type: qaType, namespaces });
      setQAResults(data.results);
      showToast(`QA complete from CSV: ${data.count} result(s) across ${namespaces.length} namespace(s)`, 'success');
    } catch (e) {
      showToast(`CSV QA failed: ${e}`, 'danger');
    } finally {
      setCsvUploading(false);
    }
  };

  const filteredQAResults = useMemo(() => {
    let filtered = qaResults;
    if (qaStatusFilter !== 'all') {
      filtered = filtered.filter(r => {
        const s = (r.status || '').toLowerCase();
        if (qaStatusFilter === 'verified') return s.includes('verified') && !s.includes('unverified');
        return s.includes('failed') || s.includes('error');
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
    const headers = ['CI Name', 'Namespace', 'CI', 'Status', 'Deployed', 'Healthy', 'Expected Seats', 'Actual Seats', 'Landing Page URL'];
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
        String(r.healthy ?? ''), expCsv, actCsv, r.landing_page_url || '',
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
      {/* QA guidance */}
      <Alert variant="info" isInline isPlain title="When to use QA" style={{ marginBottom: 16 }}>
        Run QA checks after deploying workshops to verify they were created correctly and are healthy.
        <strong> QA1</strong> should be run immediately after deployment to confirm configuration.
        <strong> QA2</strong> should be run once workshops have had time to provision (typically 10-30 min) to verify health and collect student landing page URLs.
      </Alert>

      {/* QA type selector + run controls */}
      <Split hasGutter style={{ marginBottom: 16, alignItems: 'flex-start' }}>
        <SplitItem>
          <div>
            <FormSelect
              value={qaType}
              onChange={(_e, val) => setQaType(val as '1' | '2' | 'both')}
              aria-label="QA type"
              className="qa-type-select"
              style={{ width: 220 }}
            >
              <FormSelectOption value="1" label="QA1 - Verify Setup" />
              <FormSelectOption value="2" label="QA2 - Verify Deployment" />
              <FormSelectOption value="both" label="Both" />
            </FormSelect>
            <p className="qa-type-hint">
              {qaType === '1' && 'Compares live workshops against your CSV schedule — checks dates, user counts, and configuration match what you uploaded.'}
              {qaType === '2' && 'Checks that workshops are actually provisioned and healthy, verifies seat counts, and retrieves student landing page URLs.'}
              {qaType === 'both' && 'Runs setup verification and deployment checks; the table shows one row per workshop (deployment results when both apply).'}
            </p>
          </div>
        </SplitItem>
        <SplitItem>
          <Button variant="primary" onClick={handleRun} isDisabled={running} isLoading={running}>
            Run QA
          </Button>
        </SplitItem>
        <SplitItem>
          <Button variant="secondary" onClick={handleRefresh} isLoading={refreshing} isDisabled={refreshing}>Refresh</Button>
        </SplitItem>
        <SplitItem>
          <Tooltip content="Automatically poll for updated QA results every 15 seconds">
            <Switch
              id="qa-auto-refresh"
              label="Auto-refresh (15s)"
              isChecked={autoRefresh}
              onChange={(_e, checked) => setAutoRefresh(checked)}
            />
          </Tooltip>
        </SplitItem>
        {qaResults.length > 0 && (
          <SplitItem>
            <Tooltip content="Group results by namespace with collapsible sections">
              <Switch
                id="qa-group-by-namespace"
                label="Group by Namespace"
                isChecked={groupByNamespace}
                onChange={(_e, checked) => setGroupByNamespace(checked)}
              />
            </Tooltip>
          </SplitItem>
        )}
        {qaResults.length > 0 && (
          <SplitItem>
            <Label color="blue">{qaResults.length} result(s)</Label>
          </SplitItem>
        )}
      </Split>

      {/* CSV Upload for ad-hoc QA */}
      <Card isCompact style={{ marginBottom: 16 }}>
        <CardBody>
          <Split hasGutter style={{ alignItems: 'center' }}>
            <SplitItem>
              <strong>Or run QA from CSV:</strong>
            </SplitItem>
            <SplitItem style={{ flexGrow: 1, maxWidth: 400 }}>
              <FileUpload
                id="qa-csv-upload"
                type="text"
                value={csvFile || undefined}
                filename={csvFile?.name || ''}
                filenamePlaceholder="Upload CSV to extract namespaces"
                onFileInputChange={(_e, file) => handleCsvUpload(file)}
                onClearClick={() => {
                  setCsvFile(null);
                }}
                isLoading={csvUploading}
                browseButtonText="Browse..."
                clearButtonText="Clear"
              />
            </SplitItem>
            <SplitItem>
              <Tooltip content="Upload a CSV with a 'Namespace' column. QA will run against all unique namespaces found.">
                <Label color="blue" icon={<SearchIcon />}>Ad-hoc QA</Label>
              </Tooltip>
            </SplitItem>
          </Split>
        </CardBody>
      </Card>

      {/* QA search + status filter toolbar */}
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
              <ToggleGroupItem buttonId="qa-filter-verified" text="Verified" isSelected={qaStatusFilter === 'verified'} onChange={() => { setQaStatusFilter('verified'); setPage(1); }} />
              <ToggleGroupItem buttonId="qa-filter-failed" text="Failed" isSelected={qaStatusFilter === 'failed'} onChange={() => { setQaStatusFilter('failed'); setPage(1); }} />
            </ToggleGroup>
          </SplitItem>
        </Split>
      )}

      {/* QA type explanation cards */}
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
          groupByNamespace={groupByNamespace}
        />
      ) : (
        <EmptyState titleText="No QA results yet" headingLevel="h3" icon={SearchIcon}>
          <EmptyStateBody>Select a QA type above and click Run QA after deploying your workshops.</EmptyStateBody>
        </EmptyState>
      )}

      {/* Destroy QA section */}
      <Divider style={{ margin: '24px 0' }} />
      <DestroyQASection showToast={showToast} />
    </PageSection>
  );
};
