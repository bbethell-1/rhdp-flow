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
import { Table, Thead, Tbody, Tr, Th, Td } from '@patternfly/react-table';
import UsersIcon from '@patternfly/react-icons/dist/esm/icons/users-icon';
import CopyIcon from '@patternfly/react-icons/dist/esm/icons/copy-icon';

import { api } from '../services/api';
import type { QAResult } from '../types';

interface Props {
  qaResults: QAResult[];
}

export const StudentsTab: React.FC<Props> = ({ qaResults }) => {
  const students = qaResults.filter(r => r.landing_page_url);

  return (
    <PageSection>
      <Split hasGutter style={{ marginBottom: 16, alignItems: 'center' }}>
        <SplitItem>
          <Title headingLevel="h3">Student Landing Pages ({students.length})</Title>
        </SplitItem>
        <SplitItem isFilled />
        <SplitItem>
          <Button
            variant="secondary"
            component="a"
            href={api.exportStudentsURL}
            isDisabled={students.length === 0}
          >
            Download CSV
          </Button>
        </SplitItem>
      </Split>

      {students.length > 0 ? (
        <div className="table-scroll-wrapper">
        <Table aria-label="Student landing pages" variant="compact" className="fixed-table">
          <Thead>
            <Tr>
              <Th>CI Name</Th>
              <Th>Landing Page URL</Th>
              <Th>Status</Th>
            </Tr>
          </Thead>
          <Tbody>
            {students.map((r, i) => (
              <Tr key={i}>
                <Td dataLabel="CI Name">{r.ci_name}</Td>
                <Td dataLabel="Landing Page URL">
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    <a href={r.landing_page_url} target="_blank" rel="noopener noreferrer" className="cell-truncate" title={r.landing_page_url}>{r.landing_page_url}</a>
                    <Tooltip content="Copy URL">
                      <Button
                        variant="plain"
                        size="sm"
                        style={{ padding: '2px 4px' }}
                        onClick={() => navigator.clipboard.writeText(r.landing_page_url)}
                        aria-label="Copy URL"
                      >
                        <CopyIcon />
                      </Button>
                    </Tooltip>
                  </span>
                </Td>
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
