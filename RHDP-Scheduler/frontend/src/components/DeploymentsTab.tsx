import { useState, useMemo, useCallback } from 'react';
import {
  Button,
  PageSection,
  Title,
  Split,
  SplitItem,
  EmptyState,
  EmptyStateBody,
  Card,
  CardBody,
  Flex,
  FlexItem,
  Pagination,
  SearchInput,
  Switch,
  ToggleGroup,
  ToggleGroupItem,
  Tooltip,
} from '@patternfly/react-core';
import { Table, Thead, Tbody, Tr, Th, Td, ThProps } from '@patternfly/react-table';
import CubesIcon from '@patternfly/react-icons/dist/esm/icons/cubes-icon';
import CopyIcon from '@patternfly/react-icons/dist/esm/icons/copy-icon';
import RedoIcon from '@patternfly/react-icons/dist/esm/icons/redo-icon';

import { api } from '../services/api';
import { useAutoRefresh } from '../hooks/useAutoRefresh';
import type { DeploymentResult } from '../types';

function isFailed(status: string): boolean {
  const s = (status || '').toLowerCase();
  return s.includes('failed') || s.includes('error');
}

interface Props {
  results: DeploymentResult[];
  setResults: (r: DeploymentResult[]) => void;
  showToast: (msg: string, variant: 'success' | 'danger' | 'info') => void;
}

const STATUS_LABELS: Record<string, string> = {
  verified: 'Verified',
  deployed_unverified: 'Deployed (Unverified)',
  deployed_no_url: 'Deployed (No URL)',
  failed: 'Failed',
  error: 'Error',
};

function formatStatus(raw: string) {
  if (!raw) return '';
  return STATUS_LABELS[raw.toLowerCase()] || raw.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function statusClass(status: string) {
  if (!status) return '';
  const s = status.toLowerCase();
  if (s.includes('verified') && !s.includes('unverified')) return 'status-verified';
  if (s.includes('unverified') || s.includes('no_url')) return 'status-deployed_unverified';
  if (s.includes('failed') || s.includes('error')) return 'status-failed';
  return '';
}

type StatusFilter = 'all' | 'verified' | 'unverified' | 'failed';

type SortableColumn = 'ci_name' | 'ci' | 'namespace' | 'status' | 'timestamp';

export const DeploymentsTab: React.FC<Props> = ({ results, setResults, showToast }) => {
  const [searchText, setSearchText] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(20);
  const [sortBy, setSortBy] = useState<SortableColumn | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [selectedRows, setSelectedRows] = useState<Set<string>>(new Set());
  const [retrying, setRetrying] = useState(false);

  const refreshResults = useCallback(async () => {
    try {
      const r = await api.deployResults();
      setResults(r);
    } catch { /* ignore */ }
  }, [setResults]);

  useAutoRefresh(refreshResults, 15000, autoRefresh);

  // Summary counts
  const statusCounts = useMemo(() => {
    const counts = { total: results.length, verified: 0, unverified: 0, failed: 0 };
    for (const r of results) {
      const s = (r.status || '').toLowerCase();
      if (s.includes('verified') && !s.includes('unverified')) counts.verified++;
      else if (s.includes('failed') || s.includes('error')) counts.failed++;
      else counts.unverified++;
    }
    return counts;
  }, [results]);

  // Filtered and sorted results
  const filteredResults = useMemo(() => {
    let filtered = results;
    if (statusFilter !== 'all') {
      filtered = filtered.filter(r => {
        const s = (r.status || '').toLowerCase();
        if (statusFilter === 'verified') return s.includes('verified') && !s.includes('unverified');
        if (statusFilter === 'failed') return s.includes('failed') || s.includes('error');
        return !(s.includes('verified') && !s.includes('unverified')) && !(s.includes('failed') || s.includes('error'));
      });
    }
    if (searchText) {
      const q = searchText.toLowerCase();
      filtered = filtered.filter(r =>
        r.ci_name.toLowerCase().includes(q) ||
        r.ci.toLowerCase().includes(q) ||
        r.guid.toLowerCase().includes(q) ||
        r.namespace.toLowerCase().includes(q)
      );
    }
    if (sortBy) {
      filtered = [...filtered].sort((a, b) => {
        const aVal = (a[sortBy] || '').toLowerCase();
        const bVal = (b[sortBy] || '').toLowerCase();
        const cmp = aVal.localeCompare(bVal);
        return sortDir === 'asc' ? cmp : -cmp;
      });
    }
    return filtered;
  }, [results, statusFilter, searchText, sortBy, sortDir]);

  // Paginated results
  const paginatedResults = useMemo(() => {
    const start = (page - 1) * perPage;
    return filteredResults.slice(start, start + perPage);
  }, [filteredResults, page, perPage]);

  const handleRefresh = async () => {
    try {
      const r = await api.deployResults();
      setResults(r);
      showToast(`Refreshed: ${r.length} result(s)`, 'success');
    } catch (e) {
      showToast(`Refresh failed: ${e}`, 'danger');
    }
  };

  const handleRetry = async (ciNames: string[]) => {
    if (ciNames.length === 0) return;
    setRetrying(true);
    try {
      await api.retry({ ci_names: ciNames });
      showToast(`Retrying ${ciNames.length} deployment(s)...`, 'info');
      // Refresh results after a short delay
      setTimeout(async () => {
        try {
          const r = await api.deployResults();
          setResults(r);
          setSelectedRows(new Set());
        } catch { /* ignore */ }
        setRetrying(false);
      }, 3000);
    } catch (e) {
      showToast(`Retry failed: ${e}`, 'danger');
      setRetrying(false);
    }
  };

  const handleRetrySelected = () => {
    handleRetry(Array.from(selectedRows));
  };

  const toggleRow = (ciName: string) => {
    setSelectedRows(prev => {
      const next = new Set(prev);
      if (next.has(ciName)) next.delete(ciName); else next.add(ciName);
      return next;
    });
  };

  const toggleAllOnPage = () => {
    const pageNames = paginatedResults.map(r => r.ci_name);
    const allSelected = pageNames.every(n => selectedRows.has(n));
    if (allSelected) {
      setSelectedRows(prev => {
        const next = new Set(prev);
        pageNames.forEach(n => next.delete(n));
        return next;
      });
    } else {
      setSelectedRows(prev => {
        const next = new Set(prev);
        pageNames.forEach(n => next.add(n));
        return next;
      });
    }
  };

  const getSortParams = (col: SortableColumn): ThProps['sort'] => ({
    sortBy: sortBy === col ? { index: 0, direction: sortDir } : { index: 0, direction: 'asc', defaultDirection: 'asc' },
    onSort: () => {
      if (sortBy === col) {
        setSortDir(prev => prev === 'asc' ? 'desc' : 'asc');
      } else {
        setSortBy(col);
        setSortDir('asc');
      }
      setPage(1);
    },
    columnIndex: 0,
  });

  const isFiltered = statusFilter !== 'all' || searchText.length > 0;
  const titleText = isFiltered
    ? `Deployment Results (${filteredResults.length} of ${results.length})`
    : `Deployment Results (${results.length})`;

  return (
    <PageSection>
      {/* Summary cards */}
      {results.length > 0 && (
        <Flex style={{ marginBottom: 16 }} gap={{ default: 'gapMd' }}>
          <FlexItem>
            <Card isCompact isPlain>
              <CardBody>
                <div className="summary-card-value">{statusCounts.total}</div>
                <div className="summary-card-label">Total</div>
              </CardBody>
            </Card>
          </FlexItem>
          <FlexItem>
            <Card isCompact isPlain>
              <CardBody>
                <div className="summary-card-value status-verified">{statusCounts.verified}</div>
                <div className="summary-card-label">Verified</div>
              </CardBody>
            </Card>
          </FlexItem>
          <FlexItem>
            <Card isCompact isPlain>
              <CardBody>
                <div className="summary-card-value status-deployed_unverified">{statusCounts.unverified}</div>
                <div className="summary-card-label">Unverified</div>
              </CardBody>
            </Card>
          </FlexItem>
          <FlexItem>
            <Card isCompact isPlain>
              <CardBody>
                <div className="summary-card-value status-failed">{statusCounts.failed}</div>
                <div className="summary-card-label">Failed</div>
              </CardBody>
            </Card>
          </FlexItem>
        </Flex>
      )}

      {/* Toolbar */}
      <Split hasGutter style={{ marginBottom: 16, alignItems: 'center' }}>
        <SplitItem>
          <Title headingLevel="h3">{titleText}</Title>
        </SplitItem>
        <SplitItem isFilled />
        <SplitItem>
          <SearchInput
            placeholder="Search CI, GUID, namespace..."
            value={searchText}
            onChange={(_e, val) => { setSearchText(val); setPage(1); }}
            onClear={() => { setSearchText(''); setPage(1); }}
            style={{ width: 250 }}
          />
        </SplitItem>
        <SplitItem>
          <ToggleGroup aria-label="Status filter">
            <ToggleGroupItem text="All" isSelected={statusFilter === 'all'} onChange={() => { setStatusFilter('all'); setPage(1); }} />
            <ToggleGroupItem text="Verified" isSelected={statusFilter === 'verified'} onChange={() => { setStatusFilter('verified'); setPage(1); }} />
            <ToggleGroupItem text="Unverified" isSelected={statusFilter === 'unverified'} onChange={() => { setStatusFilter('unverified'); setPage(1); }} />
            <ToggleGroupItem text="Failed" isSelected={statusFilter === 'failed'} onChange={() => { setStatusFilter('failed'); setPage(1); }} />
          </ToggleGroup>
        </SplitItem>
      </Split>

      <Split hasGutter style={{ marginBottom: 16, alignItems: 'center' }}>
        <SplitItem>
          <Switch
            id="auto-refresh-switch"
            label="Auto-refresh (15s)"
            isChecked={autoRefresh}
            onChange={(_e, checked) => setAutoRefresh(checked)}
          />
        </SplitItem>
        <SplitItem isFilled />
        <SplitItem>
          <Button variant="secondary" onClick={handleRefresh}>Refresh</Button>
        </SplitItem>
        <SplitItem>
          <Button
            variant="secondary"
            component="a"
            href={api.exportResultsURL}
            isDisabled={results.length === 0}
          >
            Download CSV
          </Button>
        </SplitItem>
        {selectedRows.size > 0 && (
          <SplitItem>
            <Button
              variant="warning"
              icon={<RedoIcon />}
              onClick={handleRetrySelected}
              isLoading={retrying}
              isDisabled={retrying}
            >
              Retry Selected ({selectedRows.size})
            </Button>
          </SplitItem>
        )}
      </Split>

      {filteredResults.length > 0 ? (
        <>
          <div className="table-sticky-wrapper">
          <Table aria-label="Deployment results" variant="compact" className="fixed-table" isStickyHeader>
            <Thead>
              <Tr>
                <Th
                  select={{
                    onSelect: toggleAllOnPage,
                    isSelected: paginatedResults.length > 0 && paginatedResults.every(r => selectedRows.has(r.ci_name)),
                  }}
                />
                <Th sort={getSortParams('ci_name')}>CI Name</Th>
                <Th sort={getSortParams('ci')}>CI</Th>
                <Th sort={getSortParams('namespace')}>Namespace</Th>
                <Th>GUID</Th>
                <Th sort={getSortParams('status')}>Status</Th>
                <Th>URL</Th>
                <Th>Prov. Date (UTC)</Th>
                <Th>Auto-Stop (UTC)</Th>
                <Th>Auto-Destroy (UTC)</Th>
                <Th sort={getSortParams('timestamp')}>Timestamp (UTC)</Th>
                <Th>Error</Th>
                <Th>Actions</Th>
              </Tr>
            </Thead>
            <Tbody>
              {paginatedResults.map((r, i) => (
                <Tr key={i}>
                  <Td
                    select={{
                      rowIndex: i,
                      onSelect: () => toggleRow(r.ci_name),
                      isSelected: selectedRows.has(r.ci_name),
                    }}
                  />
                  <Td dataLabel="CI Name">{r.ci_name}</Td>
                  <Td dataLabel="CI">{r.ci}</Td>
                  <Td dataLabel="Namespace">{r.namespace}</Td>
                  <Td dataLabel="GUID">{r.guid}</Td>
                  <Td dataLabel="Status"><span className={statusClass(r.status)}>{formatStatus(r.status)}</span></Td>
                  <Td dataLabel="URL">
                    {r.url ? (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                        <a href={r.url} target="_blank" rel="noopener noreferrer" className="cell-truncate" title={r.url}>{r.url}</a>
                        <Tooltip content="Copy URL">
                          <Button
                            variant="plain"
                            size="sm"
                            style={{ padding: '2px 4px' }}
                            onClick={() => navigator.clipboard.writeText(r.url)}
                            aria-label="Copy URL"
                          >
                            <CopyIcon />
                          </Button>
                        </Tooltip>
                      </span>
                    ) : '-'}
                  </Td>
                  <Td dataLabel="Prov. Date (UTC)" className="date-cell">{r.provisioning_date}</Td>
                  <Td dataLabel="Auto-Stop (UTC)" className="date-cell">{r.auto_stop || '-'}</Td>
                  <Td dataLabel="Auto-Destroy (UTC)" className="date-cell">{r.auto_destroy || '-'}</Td>
                  <Td dataLabel="Timestamp (UTC)" className="date-cell">{r.timestamp}</Td>
                  <Td dataLabel="Error">{r.error_message || ''}</Td>
                  <Td dataLabel="Actions">
                    {isFailed(r.status) && (
                      <Tooltip content="Retry this deployment">
                        <Button
                          variant="plain"
                          size="sm"
                          onClick={() => handleRetry([r.ci_name])}
                          isDisabled={retrying}
                          aria-label="Retry"
                        >
                          <RedoIcon />
                        </Button>
                      </Tooltip>
                    )}
                  </Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
          </div>
          {filteredResults.length > perPage && (
            <Pagination
              itemCount={filteredResults.length}
              perPage={perPage}
              page={page}
              onSetPage={(_e, p) => setPage(p)}
              onPerPageSelect={(_e, pp) => { setPerPage(pp); setPage(1); }}
              perPageOptions={[
                { title: '10', value: 10 },
                { title: '20', value: 20 },
                { title: '50', value: 50 },
                { title: '100', value: 100 },
              ]}
              style={{ marginTop: 8 }}
            />
          )}
        </>
      ) : results.length > 0 ? (
        <EmptyState titleText="No matching results" headingLevel="h3" icon={CubesIcon}>
          <EmptyStateBody>Try adjusting your search or filter criteria.</EmptyStateBody>
        </EmptyState>
      ) : (
        <EmptyState titleText="No deployment results yet" headingLevel="h3" icon={CubesIcon}>
          <EmptyStateBody>Deploy schedules from the Upload tab to see results here.</EmptyStateBody>
        </EmptyState>
      )}
    </PageSection>
  );
};
