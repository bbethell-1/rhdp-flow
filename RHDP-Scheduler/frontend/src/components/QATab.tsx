import { useState, useMemo, useCallback } from 'react';
import {
  Alert,
  Button,
  Card,
  CardBody,
  CardTitle,
  Divider,
  PageSection,
  Pagination,
  SearchInput,
  Split,
  SplitItem,
  FormSelect,
  FormSelectOption,
  EmptyState,
  EmptyStateBody,
  Label,
  Switch,
  TextInput,
  Title,
  ToggleGroup,
  ToggleGroupItem,
  Tooltip,
} from '@patternfly/react-core';
import { useAutoRefresh } from '../hooks/useAutoRefresh';
import { Table, Thead, Tbody, Tr, Th, Td, ThProps, ExpandableRowContent } from '@patternfly/react-table';
import SearchIcon from '@patternfly/react-icons/dist/esm/icons/search-icon';
import CheckCircleIcon from '@patternfly/react-icons/dist/esm/icons/check-circle-icon';
import InProgressIcon from '@patternfly/react-icons/dist/esm/icons/in-progress-icon';
import ExclamationCircleIcon from '@patternfly/react-icons/dist/esm/icons/exclamation-circle-icon';
import InfoCircleIcon from '@patternfly/react-icons/dist/esm/icons/info-circle-icon';
import { ChartDonut } from '@patternfly/react-charts/victory';

import { api } from '../services/api';
import { AUTO_REFRESH_INTERVAL_MS, DEFAULT_PER_PAGE } from '../constants';
import { statusColorClass, statusIcon } from '../utils/statusColors';
import type { QAResult, DestroyCheckResult, ResourceStatus } from '../types';

interface Props {
  qaResults: QAResult[];
  setQAResults: (r: QAResult[]) => void;
  showToast: (msg: string, variant: 'success' | 'danger' | 'info') => void;
}

function healthyDisplay(h: boolean | string | null | undefined): string {
  if (h === true || h === 'Yes') return 'Yes';
  if (h === false) return 'No';
  return String(h ?? '-');
}

function healthyColorClass(h: boolean | string | null | undefined): string {
  if (h === true || h === 'Yes') return 'status-verified';
  if (h === false || h === 'No') return 'status-failed';
  return '';
}

type SortableQAColumn = 'ci_name' | 'ci' | 'status';

type QAStatusFilter = 'all' | 'verified' | 'failed';

export const QATab: React.FC<Props> = ({ qaResults, setQAResults, showToast }) => {
  const [qaType, setQaType] = useState<'1' | '2' | 'both'>('both');
  const [running, setRunning] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(DEFAULT_PER_PAGE);
  const [sortBy, setSortBy] = useState<SortableQAColumn | null>(null);
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
    const headers = ['CI Name', 'CI', 'Status', 'Deployed', 'Healthy', 'Expected Seats', 'Actual Seats', 'Landing Page URL'];
    const rows = filteredQAResults.map(r => [
      r.ci_name, r.ci, r.status, r.deployed,
      String(r.healthy ?? ''), String(r.expected_seats ?? ''),
      String(r.actual_seats ?? ''), r.landing_page_url || '',
    ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(','));
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
              style={{ width: 220 }}
            >
              <FormSelectOption value="1" label="QA1 - Verify Setup" />
              <FormSelectOption value="2" label="QA2 - Verify Deployment" />
              <FormSelectOption value="both" label="Both" />
            </FormSelect>
            <p className="qa-type-hint">
              {qaType === '1' && 'Compares live workshops against your CSV schedule — checks dates, user counts, and configuration match what you uploaded.'}
              {qaType === '2' && 'Checks that workshops are actually provisioned and healthy, verifies seat counts, and retrieves student landing page URLs.'}
              {qaType === 'both' && 'Runs setup verification first, then checks deployment health and collects landing page URLs.'}
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
            <Label color="blue">{qaResults.length} result(s)</Label>
          </SplitItem>
        )}
      </Split>

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
              placeholder="Search CI name, CI..."
              value={qaSearch}
              onChange={(_e, val) => { setQaSearch(val); setPage(1); }}
              onClear={() => { setQaSearch(''); setPage(1); }}
              style={{ width: 250 }}
            />
          </SplitItem>
          <SplitItem>
            <ToggleGroup aria-label="QA status filter">
              <ToggleGroupItem text="All" isSelected={qaStatusFilter === 'all'} onChange={() => { setQaStatusFilter('all'); setPage(1); }} />
              <ToggleGroupItem text="Verified" isSelected={qaStatusFilter === 'verified'} onChange={() => { setQaStatusFilter('verified'); setPage(1); }} />
              <ToggleGroupItem text="Failed" isSelected={qaStatusFilter === 'failed'} onChange={() => { setQaStatusFilter('failed'); setPage(1); }} />
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

/** Format an ISO8601 UTC string as local browser time */
function utcToLocal(utcStr: string): string {
  if (!utcStr) return '';
  try {
    const d = new Date(utcStr);
    return d.toLocaleString('en-GB', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit', hour12: false,
    });
  } catch {
    return '';
  }
}

/** Color for destroy-check resource/overall status */
function destroyStatusColor(status: string): 'green' | 'blue' | 'red' | 'orange' | 'grey' {
  switch (status) {
    case 'destroyed':
    case 'not_found':
    case 'stopped':
      return 'green';
    case 'active':
    case 'pending':
      return 'blue';
    case 'overdue':
    case 'stop_overdue':
      return 'red';
    case 'not_deployed':
      return 'orange';
    default:
      return 'grey';
  }
}

/** Icon for destroy-check status */
function destroyStatusIcon(status: string): React.ComponentType<{ style?: React.CSSProperties }> | null {
  switch (status) {
    case 'destroyed':
    case 'not_found':
    case 'stopped':
      return CheckCircleIcon;
    case 'active':
    case 'pending':
      return InProgressIcon;
    case 'overdue':
    case 'stop_overdue':
      return ExclamationCircleIcon;
    case 'not_deployed':
    case 'n/a':
      return InfoCircleIcon;
    default:
      return null;
  }
}

/** CSS class for row coloring by overall status */
function destroyRowClass(status: string): string {
  switch (status) {
    case 'destroyed':
    case 'not_found':
      return 'destroy-row-destroyed';
    case 'active':
    case 'pending':
      return 'destroy-row-active';
    case 'overdue':
    case 'stop_overdue':
      return 'destroy-row-overdue';
    case 'not_deployed':
      return 'destroy-row-not_deployed';
    default:
      return '';
  }
}

/** Calculate overdue duration text */
function overdueText(scheduledDestroy: string): string | null {
  if (!scheduledDestroy) return null;
  const now = Date.now();
  const destroyTime = new Date(scheduledDestroy).getTime();
  if (isNaN(destroyTime) || now <= destroyTime) return null;
  const diffMs = now - destroyTime;
  const hours = Math.floor(diffMs / (1000 * 60 * 60));
  const mins = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
  if (hours > 0) return `${hours}h ${mins}m overdue`;
  return `${mins}m overdue`;
}

/** Render status label with icon */
function DestroyStatusLabel({ status }: { status: string }) {
  const Icon = destroyStatusIcon(status);
  return (
    <Label color={destroyStatusColor(status)}>
      {Icon && <Icon style={{ marginRight: 4 }} />}
      {status}
    </Label>
  );
}

/** Format resource cell with lifespan + count/healthy info */
function ResourceCell({ res }: { res: ResourceStatus }) {
  const extra: string[] = [];
  if (res.count != null) extra.push(`count: ${res.count}`);
  if (res.healthy != null) extra.push(`healthy: ${res.healthy ? 'Yes' : 'No'}`);
  const tooltip = [
    res.lifespan_end ? `Lifespan end: ${res.lifespan_end}` : null,
    extra.length > 0 ? extra.join(', ') : null,
  ].filter(Boolean).join('\n');

  const content = (
    <span>
      <DestroyStatusLabel status={res.status} />
      {extra.length > 0 && (
        <span style={{ fontSize: '0.75rem', opacity: 0.7, marginLeft: 4 }}>
          ({extra.join(', ')})
        </span>
      )}
    </span>
  );

  return tooltip ? (
    <Tooltip content={<span style={{ whiteSpace: 'pre-line' }}>{tooltip}</span>}>
      {content}
    </Tooltip>
  ) : content;
}

type SortableDCColumn = 'ci_name' | 'namespace' | 'scheduled_destroy' | 'overall_status' | 'stop_status';

const DESTROY_REFRESH_INTERVAL = 30_000;

/** Destroy QA section — read-only lifecycle status checks */
const DestroyQASection: React.FC<{
  showToast: (msg: string, variant: 'success' | 'danger' | 'info') => void;
}> = ({ showToast }) => {
  const [results, setResults] = useState<DestroyCheckResult[]>([]);
  const [running, setRunning] = useState(false);
  const [dcPage, setDcPage] = useState(1);
  const [dcPerPage, setDcPerPage] = useState(DEFAULT_PER_PAGE);
  const [showLocal, setShowLocal] = useState(false);
  const [dcAutoRefresh, setDcAutoRefresh] = useState(false);
  const [dcSearch, setDcSearch] = useState('');
  const [dcSortBy, setDcSortBy] = useState<SortableDCColumn | null>(null);
  const [dcSortDir, setDcSortDir] = useState<'asc' | 'desc'>('asc');
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});
  const [nsOverride, setNsOverride] = useState('');

  const refreshDestroy = useCallback(async () => {
    try {
      const data = await api.destroyCheckResults();
      setResults(data.results);
    } catch (e) {
      console.warn('Auto-refresh destroy-check results failed', e);
    }
  }, []);

  useAutoRefresh(refreshDestroy, DESTROY_REFRESH_INTERVAL, dcAutoRefresh);

  const handleRun = async () => {
    setRunning(true);
    try {
      const data = await api.destroyCheck();
      setResults(data.results);
      setExpanded({});
      showToast(`Destroy check complete: ${data.count} result(s)`, 'success');
    } catch (e) {
      showToast(`Destroy check failed: ${e}`, 'danger');
    } finally {
      setRunning(false);
    }
  };

  const handleRefresh = async () => {
    try {
      const data = await api.destroyCheckResults();
      setResults(data.results);
    } catch (e) {
      console.warn('Refresh destroy-check results failed', e);
    }
  };

  // Filter by search
  const filtered = useMemo(() => {
    if (!dcSearch) return results;
    const q = dcSearch.toLowerCase();
    return results.filter(r =>
      r.ci_name.toLowerCase().includes(q) ||
      r.namespace.toLowerCase().includes(q)
    );
  }, [results, dcSearch]);

  // Sort
  const sorted = useMemo(() => {
    if (!dcSortBy) return filtered;
    return [...filtered].sort((a, b) => {
      const aVal = String((a as Record<string, unknown>)[dcSortBy] ?? '').toLowerCase();
      const bVal = String((b as Record<string, unknown>)[dcSortBy] ?? '').toLowerCase();
      const cmp = aVal.localeCompare(bVal);
      return dcSortDir === 'asc' ? cmp : -cmp;
    });
  }, [filtered, dcSortBy, dcSortDir]);

  // Paginate
  const paginated = useMemo(() => {
    const start = (dcPage - 1) * dcPerPage;
    return sorted.slice(start, start + dcPerPage);
  }, [sorted, dcPage, dcPerPage]);

  // Summary counts (from full results, not filtered)
  const destroyed = results.filter(r => r.overall_status === 'destroyed').length;
  const active = results.filter(r => r.overall_status === 'active').length;
  const overdue = results.filter(r => r.overall_status === 'overdue').length;
  const notDeployed = results.filter(r => r.overall_status === 'not_deployed').length;

  const getSortParams = (col: SortableDCColumn): ThProps['sort'] => ({
    sortBy: dcSortBy === col ? { index: 0, direction: dcSortDir } : { index: 0, direction: 'asc', defaultDirection: 'asc' },
    onSort: () => {
      if (dcSortBy === col) {
        setDcSortDir(dcSortDir === 'asc' ? 'desc' : 'asc');
      } else {
        setDcSortBy(col);
        setDcSortDir('asc');
      }
      setDcPage(1);
    },
    columnIndex: 0,
  });

  const toggleExpand = (idx: number) => {
    setExpanded(prev => ({ ...prev, [idx]: !prev[idx] }));
  };

  const handleDownloadDestroyCSV = () => {
    const headers = ['CI Name', 'CI', 'Namespace', 'Scheduled Destroy', 'Scheduled Stop', 'Workshop', 'WP', 'RC', 'Overall', 'Stop Status'];
    const rows = sorted.map(r => [
      r.ci_name, r.ci, r.namespace, r.scheduled_destroy, r.scheduled_stop,
      r.workshop.status, r.workshop_provision.status, r.resource_claim.status,
      r.overall_status, r.stop_status,
    ].map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(','));
    const csv = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'destroy-check-results.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  // Donut chart data
  const chartData = useMemo(() => [
    { x: 'Destroyed', y: destroyed },
    { x: 'Active', y: active },
    { x: 'Overdue', y: overdue },
    { x: 'Not deployed', y: notDeployed },
  ].filter(d => d.y > 0), [destroyed, active, overdue, notDeployed]);

  const chartColors: Record<string, string> = {
    Destroyed: '#3e8635',
    Active: '#06c',
    Overdue: '#c9190b',
    'Not deployed': '#f0ab00',
  };

  const numCols = 11; // for expandable row colSpan

  return (
    <>
      <Title headingLevel="h3" style={{ marginBottom: 8 }}>Destroy QA</Title>
      <Alert variant="info" isInline isPlain title="Read-only lifecycle check" style={{ marginBottom: 12 }}>
        Checks whether Workshop, WorkshopProvision, and ResourceClaim resources still exist after their scheduled destroy time. Does not delete anything.
      </Alert>

      <Split hasGutter style={{ marginBottom: 16, alignItems: 'center' }}>
        <SplitItem>
          <Button variant="primary" onClick={handleRun} isDisabled={running} isLoading={running}>
            Run Destroy Check
          </Button>
        </SplitItem>
        {results.length > 0 && (
          <SplitItem>
            <Button variant="secondary" onClick={handleRefresh}>Refresh</Button>
          </SplitItem>
        )}
        {results.length > 0 && (
          <SplitItem>
            <Button variant="secondary" onClick={handleDownloadDestroyCSV}>
              Export CSV
            </Button>
          </SplitItem>
        )}
        {results.length > 0 && (
          <SplitItem>
            <Tooltip content={`Show times in your local timezone (${Intl.DateTimeFormat().resolvedOptions().timeZone})`}>
              <Switch
                id="destroy-qa-local-time"
                label="Local time"
                isChecked={showLocal}
                onChange={(_e, checked) => setShowLocal(checked)}
              />
            </Tooltip>
          </SplitItem>
        )}
        <SplitItem>
          <Tooltip content="Automatically poll for updated destroy check results every 30 seconds">
            <Switch
              id="destroy-qa-auto-refresh"
              label="Auto-refresh (30s)"
              isChecked={dcAutoRefresh}
              onChange={(_e, checked) => setDcAutoRefresh(checked)}
            />
          </Tooltip>
        </SplitItem>
      </Split>

      {/* Namespace override input */}
      <Split hasGutter style={{ marginBottom: 16, alignItems: 'center' }}>
        <SplitItem>
          <TextInput
            value={nsOverride}
            onChange={(_e, val) => setNsOverride(val)}
            placeholder="Optional: namespace override"
            aria-label="Namespace override"
            style={{ width: 280 }}
          />
        </SplitItem>
        {nsOverride && (
          <SplitItem>
            <Label isCompact color="blue">Override: {nsOverride}</Label>
          </SplitItem>
        )}
      </Split>

      {results.length > 0 && (
        <>
          {/* Summary: chart + labels side-by-side */}
          <Split hasGutter style={{ marginBottom: 16, alignItems: 'center' }}>
            <SplitItem>
              <Card isCompact className="destroy-chart-card">
                <CardBody>
                  <ChartDonut
                    data={chartData}
                    title={`${results.length}`}
                    subTitle="Total"
                    colorScale={chartData.map(d => chartColors[d.x] || '#8a8d90')}
                    width={200}
                    height={200}
                    innerRadius={55}
                    padding={{ top: 0, bottom: 0, left: 0, right: 0 }}
                  />
                </CardBody>
              </Card>
            </SplitItem>
            <SplitItem>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <Label color="green">Destroyed: {destroyed}</Label>
                <Label color="blue">Active: {active}</Label>
                <Label color="red">Overdue: {overdue}</Label>
                <Label color="orange">Not deployed: {notDeployed}</Label>
              </div>
            </SplitItem>
            <SplitItem isFilled />
            <SplitItem>
              <SearchInput
                placeholder="Filter by CI name or namespace..."
                value={dcSearch}
                onChange={(_e, val) => { setDcSearch(val); setDcPage(1); }}
                onClear={() => { setDcSearch(''); setDcPage(1); }}
                style={{ width: 280 }}
              />
            </SplitItem>
          </Split>

          {/* Results table */}
          <div className="table-sticky-wrapper">
          <Table aria-label="Destroy check results" variant="compact" className="fixed-table" isStickyHeader>
            <Thead>
              <Tr>
                <Th screenReaderText="Row expansion" />
                <Th sort={getSortParams('ci_name')}>CI Name</Th>
                <Th sort={getSortParams('namespace')}>Namespace</Th>
                <Th sort={getSortParams('scheduled_destroy')} info={{ tooltip: 'Scheduled auto-destroy time from CSV' }}>Sched. Destroy</Th>
                <Th info={{ tooltip: 'Scheduled auto-stop time from CSV' }}>Sched. Stop</Th>
                <Th info={{ tooltip: 'Workshop resource status' }}>Workshop</Th>
                <Th info={{ tooltip: 'WorkshopProvision resource status' }}>WP</Th>
                <Th info={{ tooltip: 'ResourceClaim resource status' }}>RC</Th>
                <Th sort={getSortParams('overall_status')} info={{ tooltip: 'Overall lifecycle status' }}>Overall</Th>
                <Th sort={getSortParams('stop_status')} info={{ tooltip: 'Auto-stop lifecycle status' }}>Stop Status</Th>
              </Tr>
            </Thead>
            <Tbody>
              {paginated.map((r, i) => {
                const rowIdx = (dcPage - 1) * dcPerPage + i;
                const isExpanded = !!expanded[rowIdx];
                const overdue_badge = (r.overall_status === 'overdue' || r.overall_status === 'stop_overdue')
                  ? overdueText(r.scheduled_destroy)
                  : null;
                return (
                  <React.Fragment key={rowIdx}>
                    <Tr className={destroyRowClass(r.overall_status)}>
                      <Td
                        expand={{
                          rowIndex: rowIdx,
                          isExpanded,
                          onToggle: () => toggleExpand(rowIdx),
                        }}
                      />
                      <Td dataLabel="CI Name">{r.ci_name}</Td>
                      <Td dataLabel="Namespace">{r.namespace}</Td>
                      <Td dataLabel="Sched. Destroy" className="date-cell">
                        {r.scheduled_destroy
                          ? showLocal
                            ? <>{utcToLocal(r.scheduled_destroy)}<br /><span style={{ fontSize: '0.8em', opacity: 0.7 }}>{r.scheduled_destroy}</span></>
                            : r.scheduled_destroy
                          : '-'}
                        {overdue_badge && (
                          <Label color="red" isCompact className="overdue-badge">{overdue_badge}</Label>
                        )}
                      </Td>
                      <Td dataLabel="Sched. Stop" className="date-cell">
                        {r.scheduled_stop
                          ? showLocal
                            ? <>{utcToLocal(r.scheduled_stop)}<br /><span style={{ fontSize: '0.8em', opacity: 0.7 }}>{r.scheduled_stop}</span></>
                            : r.scheduled_stop
                          : '-'}
                      </Td>
                      <Td dataLabel="Workshop"><ResourceCell res={r.workshop} /></Td>
                      <Td dataLabel="WP"><ResourceCell res={r.workshop_provision} /></Td>
                      <Td dataLabel="RC"><ResourceCell res={r.resource_claim} /></Td>
                      <Td dataLabel="Overall">
                        <DestroyStatusLabel status={r.overall_status} />
                      </Td>
                      <Td dataLabel="Stop Status">
                        <DestroyStatusLabel status={r.stop_status} />
                      </Td>
                    </Tr>
                    {isExpanded && (
                      <Tr isExpanded>
                        <Td colSpan={numCols}>
                          <ExpandableRowContent>
                            <div className="schedule-detail-grid">
                              <div>
                                <strong>Workshop</strong>
                                <pre style={{ fontSize: '0.8rem', whiteSpace: 'pre-wrap', margin: '4px 0' }}>
                                  {JSON.stringify(r.workshop, null, 2)}
                                </pre>
                              </div>
                              <div>
                                <strong>WorkshopProvision</strong>
                                <pre style={{ fontSize: '0.8rem', whiteSpace: 'pre-wrap', margin: '4px 0' }}>
                                  {JSON.stringify(r.workshop_provision, null, 2)}
                                </pre>
                              </div>
                              <div>
                                <strong>ResourceClaim</strong>
                                <pre style={{ fontSize: '0.8rem', whiteSpace: 'pre-wrap', margin: '4px 0' }}>
                                  {JSON.stringify(r.resource_claim, null, 2)}
                                </pre>
                              </div>
                            </div>
                            <div style={{ marginTop: 8, fontSize: '0.85rem' }}>
                              <strong>Scheduled Destroy:</strong> {r.scheduled_destroy || '-'}
                              {' | '}
                              <strong>Scheduled Stop:</strong> {r.scheduled_stop || '-'}
                              {' | '}
                              <strong>Overall:</strong> {r.overall_status}
                              {' | '}
                              <strong>Stop Status:</strong> {r.stop_status}
                            </div>
                          </ExpandableRowContent>
                        </Td>
                      </Tr>
                    )}
                  </React.Fragment>
                );
              })}
            </Tbody>
          </Table>
          </div>
          {sorted.length > dcPerPage && (
            <Pagination
              itemCount={sorted.length}
              perPage={dcPerPage}
              page={dcPage}
              onSetPage={(_e, p) => setDcPage(p)}
              onPerPageSelect={(_e, pp) => { setDcPerPage(pp); setDcPage(1); }}
              perPageOptions={[
                { title: '10', value: 10 },
                { title: '20', value: 20 },
                { title: '50', value: 50 },
              ]}
              style={{ marginTop: 8 }}
            />
          )}
        </>
      )}
    </>
  );
};

/** Extracted QA results table with sorting + pagination */
const QAResultsTable: React.FC<{
  qaResults: QAResult[];
  title: string;
  page: number;
  setPage: (p: number) => void;
  perPage: number;
  setPerPage: (pp: number) => void;
  sortBy: SortableQAColumn | null;
  setSortBy: (c: SortableQAColumn) => void;
  sortDir: 'asc' | 'desc';
  setSortDir: (d: 'asc' | 'desc') => void;
}> = ({ qaResults, title, page, setPage, perPage, setPerPage, sortBy, setSortBy, sortDir, setSortDir }) => {
  const sorted = useMemo(() => {
    if (!sortBy) return qaResults;
    return [...qaResults].sort((a, b) => {
      const aVal = (String(a[sortBy] || '')).toLowerCase();
      const bVal = (String(b[sortBy] || '')).toLowerCase();
      const cmp = aVal.localeCompare(bVal);
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [qaResults, sortBy, sortDir]);

  const paginated = useMemo(() => {
    const start = (page - 1) * perPage;
    return sorted.slice(start, start + perPage);
  }, [sorted, page, perPage]);

  const getSortParams = (col: SortableQAColumn): ThProps['sort'] => ({
    sortBy: sortBy === col ? { index: 0, direction: sortDir } : { index: 0, direction: 'asc', defaultDirection: 'asc' },
    onSort: () => {
      if (sortBy === col) {
        setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
      } else {
        setSortBy(col);
        setSortDir('asc');
      }
      setPage(1);
    },
    columnIndex: 0,
  });

  return (
    <>
      <Title headingLevel="h3" style={{ marginBottom: 8 }}>{title}</Title>
      <div className="table-sticky-wrapper">
      <Table aria-label="QA results" variant="compact" className="fixed-table" isStickyHeader>
        <Thead>
          <Tr>
            <Th sort={getSortParams('ci_name')} info={{ tooltip: 'Catalog Item display name' }}>CI Name</Th>
            <Th sort={getSortParams('ci')} info={{ tooltip: 'Catalog Item identifier (vendor.item.env)' }}>CI</Th>
            <Th sort={getSortParams('status')} info={{ tooltip: 'QA verification result: verified or failed' }}>Status</Th>
            <Th info={{ tooltip: 'Whether the workshop was successfully deployed and running' }}>Deployed</Th>
            <Th info={{ tooltip: 'Whether the deployed workshop passed health checks' }}>Healthy</Th>
            <Th info={{ tooltip: 'Expected seats (from CSV) / Actual seats (provisioned)' }}>Seats</Th>
            <Th info={{ tooltip: 'Student-facing URL for accessing the workshop — also available in the Students tab' }}>Landing Page URL</Th>
          </Tr>
        </Thead>
        <Tbody>
          {paginated.map((r, i) => (
            <Tr key={i}>
              <Td dataLabel="CI Name">{r.ci_name}</Td>
              <Td dataLabel="CI">{r.ci}</Td>
              <Td dataLabel="Status"><span className={statusColorClass(r.status)}>{(() => { const Icon = statusIcon(r.status); return Icon ? <Icon style={{ marginRight: 4 }} /> : null; })()}{r.status}</span></Td>
              <Td dataLabel="Deployed">{r.deployed || '-'}</Td>
              <Td dataLabel="Healthy"><span className={healthyColorClass(r.healthy)}>{healthyDisplay(r.healthy)}</span></Td>
              <Td dataLabel="Seats">{r.expected_seats ?? '-'} / {r.actual_seats ?? '-'}</Td>
              <Td dataLabel="Landing Page URL">
                {r.landing_page_url ? (
                  <a href={r.landing_page_url} target="_blank" rel="noopener noreferrer" className="cell-truncate" title={r.landing_page_url}>
                    {r.landing_page_url}
                  </a>
                ) : '-'}
              </Td>
            </Tr>
          ))}
        </Tbody>
      </Table>
      </div>
      {sorted.length > perPage && (
        <Pagination
          itemCount={sorted.length}
          perPage={perPage}
          page={page}
          onSetPage={(_e, p) => setPage(p)}
          onPerPageSelect={(_e, pp) => { setPerPage(pp); setPage(1); }}
          perPageOptions={[
            { title: '10', value: 10 },
            { title: '20', value: 20 },
            { title: '50', value: 50 },
          ]}
          style={{ marginTop: 8 }}
        />
      )}
    </>
  );
};
