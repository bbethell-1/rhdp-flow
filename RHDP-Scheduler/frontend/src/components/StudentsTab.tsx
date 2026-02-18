import { useState, useMemo } from 'react';
import {
  Button,
  PageSection,
  Split,
  SplitItem,
  Title,
  EmptyState,
  EmptyStateBody,
  Tooltip,
} from '@patternfly/react-core';
import { Table, Thead, Tbody, Tr, Th, Td, ThProps } from '@patternfly/react-table';
import UsersIcon from '@patternfly/react-icons/dist/esm/icons/users-icon';
import CopyIcon from '@patternfly/react-icons/dist/esm/icons/copy-icon';

import { api } from '../services/api';
import type { QAResult } from '../types';

interface Props {
  qaResults: QAResult[];
  showToast: (msg: string, variant: 'success' | 'danger' | 'info') => void;
}

type SortableStudentColumn = 'ci_name' | 'status';

export const StudentsTab: React.FC<Props> = ({ qaResults, showToast }) => {
  const students = qaResults.filter(r => r.landing_page_url);
  const hasShowroomUrls = useMemo(() => students.some(r => r.showroom_url), [students]);

  const [sortBy, setSortBy] = useState<SortableStudentColumn | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  const sorted = useMemo(() => {
    if (!sortBy) return students;
    return [...students].sort((a, b) => {
      const aVal = (String(a[sortBy] || '')).toLowerCase();
      const bVal = (String(b[sortBy] || '')).toLowerCase();
      const cmp = aVal.localeCompare(bVal);
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [students, sortBy, sortDir]);

  const getSortParams = (col: SortableStudentColumn): ThProps['sort'] => ({
    sortBy: sortBy === col ? { index: 0, direction: sortDir } : { index: 0, direction: 'asc', defaultDirection: 'asc' },
    onSort: () => {
      if (sortBy === col) {
        setSortDir(prev => prev === 'asc' ? 'desc' : 'asc');
      } else {
        setSortBy(col);
        setSortDir('asc');
      }
    },
    columnIndex: 0,
  });

  return (
    <PageSection>
      <Split hasGutter style={{ marginBottom: 16, alignItems: 'center' }}>
        <SplitItem>
          <Title headingLevel="h3">Student Landing Pages ({students.length})</Title>
        </SplitItem>
        <SplitItem isFilled />
        <SplitItem>
          <Tooltip content="Export all student landing page URLs as a CSV file for distribution">
            <Button
              variant="secondary"
              component="a"
              href={api.exportStudentsURL}
              isDisabled={students.length === 0}
            >
              Download CSV
            </Button>
          </Tooltip>
        </SplitItem>
      </Split>

      {sorted.length > 0 ? (
        <div className="table-sticky-wrapper">
        <Table aria-label="Student landing pages" variant="compact" className="fixed-table" isStickyHeader>
          <Thead>
            <Tr>
              <Th sort={getSortParams('ci_name')} info={{ tooltip: 'Catalog Item display name' }}>CI Name</Th>
              <Th info={{ tooltip: 'Student-facing URL for accessing the workshop' }}>Landing Page URL</Th>
              {hasShowroomUrls && <Th info={{ tooltip: 'Showroom lab environment URL (if configured)' }}>Showroom URL</Th>}
              <Th sort={getSortParams('status')} info={{ tooltip: 'QA verification status for this workshop' }}>Status</Th>
            </Tr>
          </Thead>
          <Tbody>
            {sorted.map((r) => (
              <Tr key={`${r.ci_name}-${r.landing_page_url}`}>
                <Td dataLabel="CI Name">{r.ci_name}</Td>
                <Td dataLabel="Landing Page URL">
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    <a href={r.landing_page_url} target="_blank" rel="noopener noreferrer" className="cell-truncate" title={r.landing_page_url}>{r.landing_page_url}</a>
                    <Tooltip content="Copy URL">
                      <Button
                        variant="plain"
                        size="sm"
                        style={{ padding: '2px 4px' }}
                        onClick={() => navigator.clipboard.writeText(r.landing_page_url).then(() => showToast('URL copied to clipboard', 'success'))}
                        aria-label="Copy URL"
                      >
                        <CopyIcon />
                      </Button>
                    </Tooltip>
                  </span>
                </Td>
                {hasShowroomUrls && (
                  <Td dataLabel="Showroom URL">
                    {r.showroom_url ? (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                        <a href={r.showroom_url} target="_blank" rel="noopener noreferrer" className="cell-truncate" title={r.showroom_url}>{r.showroom_url}</a>
                        <Tooltip content="Copy Showroom URL">
                          <Button
                            variant="plain"
                            size="sm"
                            style={{ padding: '2px 4px' }}
                            onClick={() => navigator.clipboard.writeText(r.showroom_url).then(() => showToast('Showroom URL copied', 'success'))}
                            aria-label="Copy Showroom URL"
                          >
                            <CopyIcon />
                          </Button>
                        </Tooltip>
                      </span>
                    ) : (
                      <span style={{ color: 'var(--pf-t--global--color--status--disabled--default)' }}>—</span>
                    )}
                  </Td>
                )}
                <Td dataLabel="Status">{r.status}</Td>
              </Tr>
            ))}
          </Tbody>
        </Table>
        </div>
      ) : (
        <EmptyState titleText="No student data" headingLevel="h3" icon={UsersIcon}>
          <EmptyStateBody>Run QA first to populate student landing pages.</EmptyStateBody>
        </EmptyState>
      )}
    </PageSection>
  );
};
