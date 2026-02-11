import {
  Button,
  PageSection,
  Split,
  SplitItem,
  Title,
  EmptyState,
  EmptyStateBody,
  ClipboardCopy,
} from '@patternfly/react-core';
import { Table, Thead, Tbody, Tr, Th, Td } from '@patternfly/react-table';
import UsersIcon from '@patternfly/react-icons/dist/esm/icons/users-icon';

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
        <Table aria-label="Student landing pages" variant="compact" className="fixed-table">
          <Thead>
            <Tr>
              <Th width={20}>CI Name</Th>
              <Th width={60}>Landing Page URL</Th>
              <Th width={20}>Status</Th>
            </Tr>
          </Thead>
          <Tbody>
            {students.map((r, i) => (
              <Tr key={i}>
                <Td dataLabel="CI Name">{r.ci_name}</Td>
                <Td dataLabel="Landing Page URL">
                  <ClipboardCopy variant="inline-compact" isReadOnly>{r.landing_page_url}</ClipboardCopy>
                </Td>
                <Td dataLabel="Status">{r.status}</Td>
              </Tr>
            ))}
          </Tbody>
        </Table>
      ) : (
        <EmptyState titleText="No student data" headingLevel="h3" icon={UsersIcon}>
          <EmptyStateBody>Run QA first to populate student landing pages.</EmptyStateBody>
        </EmptyState>
      )}
    </PageSection>
  );
};
