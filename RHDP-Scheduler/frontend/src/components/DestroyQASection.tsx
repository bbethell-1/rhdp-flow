import { useState, useMemo, useCallback, Fragment } from 'react';
import {
  Alert,
  Button,
  Card,
  CardBody,
  Label,
  Pagination,
  SearchInput,
  Split,
  SplitItem,
  Switch,
  TextInput,
  Title,
  Tooltip,
} from '@patternfly/react-core';
import { useAutoRefresh } from '../hooks/useAutoRefresh';
import { Table, Thead, Tbody, Tr, Th, Td, ThProps, ExpandableRowContent } from '@patternfly/react-table';
import CheckCircleIcon from '@patternfly/react-icons/dist/esm/icons/check-circle-icon';
import InProgressIcon from '@patternfly/react-icons/dist/esm/icons/in-progress-icon';
import ExclamationCircleIcon from '@patternfly/react-icons/dist/esm/icons/exclamation-circle-icon';
import InfoCircleIcon from '@patternfly/react-icons/dist/esm/icons/info-circle-icon';
import { ChartDonut } from '@patternfly/react-charts/victory';

import { api } from '../services/api';
import { DEFAULT_PER_PAGE } from '../constants';
import type { DestroyCheckResult, ResourceStatus } from '../types';

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
export const DestroyQASection: React.FC<{
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
      const aVal = String((a as unknown as Record<string, unknown>)[dcSortBy] ?? '').toLowerCase();
      const bVal = String((b as unknown as Record<string, unknown>)[dcSortBy] ?? '').toLowerCase();
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
                  <Fragment key={`${r.ci_name}-${r.namespace}`}>
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
                  </Fragment>
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
