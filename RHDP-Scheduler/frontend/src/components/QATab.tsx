import { useState, useMemo, useCallback } from 'react';
import {
  Alert,
  Button,
  Card,
  CardBody,
  CardTitle,
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
  Title,
  ToggleGroup,
  ToggleGroupItem,
  Tooltip,
} from '@patternfly/react-core';
import { useAutoRefresh } from '../hooks/useAutoRefresh';
import { Table, Thead, Tbody, Tr, Th, Td, ThProps } from '@patternfly/react-table';
import SearchIcon from '@patternfly/react-icons/dist/esm/icons/search-icon';

import { api } from '../services/api';
import { AUTO_REFRESH_INTERVAL_MS, DEFAULT_PER_PAGE } from '../constants';
import { statusColorClass, statusIcon } from '../utils/statusColors';
import type { QAResult } from '../types';

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
    </PageSection>
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
