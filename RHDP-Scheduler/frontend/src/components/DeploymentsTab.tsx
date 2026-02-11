import { useState, useMemo, useEffect } from 'react';
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
  SearchInput,
  Switch,
  ToggleGroup,
  ToggleGroupItem,
  ClipboardCopy,
} from '@patternfly/react-core';
import { Table, Thead, Tbody, Tr, Th, Td } from '@patternfly/react-table';
import CubesIcon from '@patternfly/react-icons/dist/esm/icons/cubes-icon';

import { api } from '../services/api';
import type { DeploymentResult } from '../types';

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

export const DeploymentsTab: React.FC<Props> = ({ results, setResults, showToast }) => {
  const [searchText, setSearchText] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [autoRefresh, setAutoRefresh] = useState(false);

  // Auto-refresh
  useEffect(() => {
    if (!autoRefresh) return;
    const id = setInterval(() => {
      api.deployResults().then(r => setResults(r)).catch(() => {});
    }, 15000);
    return () => clearInterval(id);
  }, [autoRefresh, setResults]);

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

  // Filtered results
  const filteredResults = useMemo(() => {
    let filtered = results;
    if (statusFilter !== 'all') {
      filtered = filtered.filter(r => {
        const s = (r.status || '').toLowerCase();
        if (statusFilter === 'verified') return s.includes('verified') && !s.includes('unverified');
        if (statusFilter === 'failed') return s.includes('failed') || s.includes('error');
        // unverified = everything else
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
    return filtered;
  }, [results, statusFilter, searchText]);

  const handleRefresh = async () => {
    try {
      const r = await api.deployResults();
      setResults(r);
      showToast(`Refreshed: ${r.length} result(s)`, 'success');
    } catch (e) {
      showToast(`Refresh failed: ${e}`, 'danger');
    }
  };

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
            onChange={(_e, val) => setSearchText(val)}
            onClear={() => setSearchText('')}
            style={{ width: 250 }}
          />
        </SplitItem>
        <SplitItem>
          <ToggleGroup aria-label="Status filter">
            <ToggleGroupItem text="All" isSelected={statusFilter === 'all'} onChange={() => setStatusFilter('all')} />
            <ToggleGroupItem text="Verified" isSelected={statusFilter === 'verified'} onChange={() => setStatusFilter('verified')} />
            <ToggleGroupItem text="Unverified" isSelected={statusFilter === 'unverified'} onChange={() => setStatusFilter('unverified')} />
            <ToggleGroupItem text="Failed" isSelected={statusFilter === 'failed'} onChange={() => setStatusFilter('failed')} />
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
      </Split>

      {filteredResults.length > 0 ? (
        <Table aria-label="Deployment results" variant="compact" className="fixed-table">
          <Thead>
            <Tr>
              <Th width={10}>CI Name</Th>
              <Th width={10}>CI</Th>
              <Th width={10}>Namespace</Th>
              <Th width={10}>GUID</Th>
              <Th width={10}>Status</Th>
              <Th width={15}>URL</Th>
              <Th width={10}>Prov. Date</Th>
              <Th width={10}>Auto-Stop</Th>
              <Th width={10}>Auto-Destroy</Th>
              <Th width={10}>Timestamp</Th>
              <Th width={10}>Error</Th>
            </Tr>
          </Thead>
          <Tbody>
            {filteredResults.map((r, i) => (
              <Tr key={i}>
                <Td dataLabel="CI Name">{r.ci_name}</Td>
                <Td dataLabel="CI"><span className="cell-truncate" title={r.ci}>{r.ci}</span></Td>
                <Td dataLabel="Namespace"><span className="cell-truncate" title={r.namespace}>{r.namespace}</span></Td>
                <Td dataLabel="GUID"><span className="cell-truncate" title={r.guid}>{r.guid}</span></Td>
                <Td dataLabel="Status"><span className={statusClass(r.status)}>{formatStatus(r.status)}</span></Td>
                <Td dataLabel="URL">
                  {r.url ? (
                    <ClipboardCopy variant="inline-compact" isReadOnly>{r.url}</ClipboardCopy>
                  ) : '-'}
                </Td>
                <Td dataLabel="Prov. Date">{r.provisioning_date}</Td>
                <Td dataLabel="Auto-Stop">{r.auto_stop || '-'}</Td>
                <Td dataLabel="Auto-Destroy">{r.auto_destroy || '-'}</Td>
                <Td dataLabel="Timestamp">{r.timestamp}</Td>
                <Td dataLabel="Error">
                  {r.error_message ? <span className="cell-truncate" title={r.error_message}>{r.error_message}</span> : ''}
                </Td>
              </Tr>
            ))}
          </Tbody>
        </Table>
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
