import React, { useState, useMemo } from 'react';
import {
  Pagination,
  Title,
  DescriptionList,
  DescriptionListGroup,
  DescriptionListTerm,
  DescriptionListDescription,
  Label,
} from '@patternfly/react-core';
import { Table, Thead, Tbody, Tr, Th, Td, ThProps, ExpandableRowContent } from '@patternfly/react-table';

import { qaStatusCategory } from '../utils/statusColors';
import type { QAResult } from '../types';

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

function seatsDisplay(r: QAResult): string {
  const rec = r as QAResult & { expected_seats?: unknown; actual_seats?: unknown; actual_users?: unknown };
  const rawExp = rec.expected_users ?? rec.expected_seats;
  const exp = rawExp === null || rawExp === undefined || rawExp === '' ? '—' : String(rawExp);
  const deployedYes = String(r.deployed || '').trim().toLowerCase() === 'yes';
  if (!deployedYes) return `${exp} / —`;
  const rawAct = rec.actual_count ?? rec.actual_seats ?? rec.actual_users;
  const act = rawAct === null || rawAct === undefined || rawAct === '' ? '—' : String(rawAct);
  return `${exp} / ${act}`;
}

function seatsColorClass(r: QAResult): string {
  const rec = r as QAResult & { expected_seats?: unknown; actual_seats?: unknown; actual_users?: unknown; seats_match?: string; matches_schedule?: string };
  if (rec.seats_match === 'No' || rec.matches_schedule === 'No') return 'status-failed';
  const rawExp = rec.expected_users ?? rec.expected_seats;
  const rawAct = rec.actual_count ?? rec.actual_seats ?? rec.actual_users;
  if (rawExp != null && rawExp !== '' && rawAct != null && rawAct !== '') {
    if (Number(rawExp) === Number(rawAct)) return 'status-verified';
    if (Number(rawAct) > 0) return 'status-deployed_unverified';
    return 'status-failed';
  }
  return '';
}

function statusLabel(status: string): React.ReactNode {
  const cat = qaStatusCategory(status);
  const color = cat === 'success' ? 'green' : cat === 'warning' ? 'orange' : cat === 'danger' ? 'red' : 'grey';
  return <Label color={color} isCompact>{status}</Label>;
}

type SortableQAColumn = 'ci_name' | 'ci' | 'status' | 'namespace';

export const QAResultsTable: React.FC<{
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
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});

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

  const toggleExpand = (idx: number) => {
    setExpanded(prev => ({ ...prev, [idx]: !prev[idx] }));
  };

  const colSpan = 8;

  return (
    <>
      <Title headingLevel="h3" style={{ marginBottom: 8 }}>{title}</Title>
      <div className="table-sticky-wrapper">
      <Table aria-label="QA results" variant="compact" className="fixed-table" isStickyHeader>
        <Thead>
          <Tr>
            <Th screenReaderText="Row expansion" />
            <Th sort={getSortParams('ci_name')} info={{ tooltip: 'Catalog Item display name' }}>CI Name</Th>
            <Th sort={getSortParams('namespace')} info={{ tooltip: 'Namespace checked during QA' }}>Namespace</Th>
            <Th sort={getSortParams('status')} info={{ tooltip: 'QA verification result' }}>Status</Th>
            <Th info={{ tooltip: 'Whether the workshop was successfully deployed' }}>Deployed</Th>
            <Th info={{ tooltip: 'Whether the deployed workshop passed health checks' }}>Healthy</Th>
            <Th info={{ tooltip: 'Expected / actual seats (— if not deployed)' }}>Seats</Th>
            <Th info={{ tooltip: 'Student-facing URL for the workshop' }}>Landing Page URL</Th>
          </Tr>
        </Thead>
        <Tbody>
          {paginated.map((r, idx) => {
            const rowIdx = (page - 1) * perPage + idx;
            const isExpanded = !!expanded[rowIdx];
            const rec = r as QAResult & Record<string, unknown>;
            const issues = String(rec.issues || '');
            const matchesSchedule = String(rec.matches_schedule || '');
            const rcName = String(rec.resourceclaim_name || '');
            const provDate = String(rec.provisioning_date || rec.expected_provisioning || '');
            const autoStop = String(rec.auto_stop || rec.expected_stop || '');
            const autoDestroy = String(rec.auto_destroy || rec.expected_destroy || '');
            const linkToService = String(rec.link_to_service || '');
            const showroomUrl = String(rec.showroom_url || '');
            const showroomStatus = String(rec.showroom_status || '');
            const workshopUsersAssigned = String(rec.workshop_users_assigned || '');
            const hasDetail = issues || rcName || provDate || autoStop || showroomUrl || linkToService;

            return (
              <React.Fragment key={`${r.ci_name}-${r.ci}-${rowIdx}`}>
                <Tr>
                  <Td
                    expand={hasDetail ? {
                      rowIndex: rowIdx,
                      isExpanded,
                      onToggle: () => toggleExpand(rowIdx),
                    } : undefined}
                  />
                  <Td dataLabel="CI Name">
                    <div>{r.ci_name}</div>
                    <div className="qa-ci-meta" title={r.ci}>{r.ci}</div>
                  </Td>
                  <Td dataLabel="Namespace">{r.namespace || '-'}</Td>
                  <Td dataLabel="Status">{statusLabel(r.status)}</Td>
                  <Td dataLabel="Deployed">
                    <span className={r.deployed === 'Yes' ? 'status-verified' : r.deployed === 'No' ? 'status-failed' : ''}>
                      {r.deployed || '-'}
                    </span>
                  </Td>
                  <Td dataLabel="Healthy"><span className={healthyColorClass(r.healthy)}>{healthyDisplay(r.healthy)}</span></Td>
                  <Td dataLabel="Seats"><span className={seatsColorClass(r)}>{seatsDisplay(r)}</span></Td>
                  <Td dataLabel="Landing Page URL">
                    {r.landing_page_url ? (
                      <a href={r.landing_page_url} target="_blank" rel="noopener noreferrer" className="cell-truncate" title={r.landing_page_url}>
                        {r.landing_page_url}
                      </a>
                    ) : '-'}
                  </Td>
                </Tr>
                {isExpanded && (
                  <Tr isExpanded>
                    <Td colSpan={colSpan}>
                      <ExpandableRowContent>
                        <DescriptionList isHorizontal isCompact columnModifier={{ default: '2Col' }}>
                          {rcName && (
                            <DescriptionListGroup>
                              <DescriptionListTerm>Resource</DescriptionListTerm>
                              <DescriptionListDescription>{rcName}</DescriptionListDescription>
                            </DescriptionListGroup>
                          )}
                          {matchesSchedule && (
                            <DescriptionListGroup>
                              <DescriptionListTerm>Matches Schedule</DescriptionListTerm>
                              <DescriptionListDescription>
                                <span className={matchesSchedule === 'Yes' ? 'status-verified' : 'status-failed'}>{matchesSchedule}</span>
                              </DescriptionListDescription>
                            </DescriptionListGroup>
                          )}
                          {provDate && (
                            <DescriptionListGroup>
                              <DescriptionListTerm>Provisioning Date</DescriptionListTerm>
                              <DescriptionListDescription>{provDate}</DescriptionListDescription>
                            </DescriptionListGroup>
                          )}
                          {autoStop && (
                            <DescriptionListGroup>
                              <DescriptionListTerm>Auto-Stop</DescriptionListTerm>
                              <DescriptionListDescription>{autoStop}</DescriptionListDescription>
                            </DescriptionListGroup>
                          )}
                          {autoDestroy && (
                            <DescriptionListGroup>
                              <DescriptionListTerm>Auto-Destroy</DescriptionListTerm>
                              <DescriptionListDescription>{autoDestroy}</DescriptionListDescription>
                            </DescriptionListGroup>
                          )}
                          {workshopUsersAssigned && (
                            <DescriptionListGroup>
                              <DescriptionListTerm>Users Assigned</DescriptionListTerm>
                              <DescriptionListDescription>{workshopUsersAssigned}</DescriptionListDescription>
                            </DescriptionListGroup>
                          )}
                          {linkToService && (
                            <DescriptionListGroup>
                              <DescriptionListTerm>Link to Service</DescriptionListTerm>
                              <DescriptionListDescription>
                                <a href={linkToService} target="_blank" rel="noopener noreferrer">{linkToService}</a>
                              </DescriptionListDescription>
                            </DescriptionListGroup>
                          )}
                          {showroomUrl && (
                            <DescriptionListGroup>
                              <DescriptionListTerm>Showroom</DescriptionListTerm>
                              <DescriptionListDescription>
                                <a href={showroomUrl} target="_blank" rel="noopener noreferrer">{showroomUrl}</a>
                                {showroomStatus && <> ({showroomStatus})</>}
                              </DescriptionListDescription>
                            </DescriptionListGroup>
                          )}
                          {issues && (
                            <DescriptionListGroup>
                              <DescriptionListTerm>Issues</DescriptionListTerm>
                              <DescriptionListDescription>
                                <span className="status-failed">{issues}</span>
                              </DescriptionListDescription>
                            </DescriptionListGroup>
                          )}
                        </DescriptionList>
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
