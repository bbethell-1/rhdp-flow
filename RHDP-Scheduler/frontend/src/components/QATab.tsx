import { useState } from 'react';
import {
  Button,
  PageSection,
  Split,
  SplitItem,
  FormSelect,
  FormSelectOption,
  EmptyState,
  EmptyStateBody,
  Label,
} from '@patternfly/react-core';
import { Table, Thead, Tbody, Tr, Th, Td } from '@patternfly/react-table';
import SearchIcon from '@patternfly/react-icons/dist/esm/icons/search-icon';

import { api } from '../services/api';
import type { QAResult } from '../types';

interface Props {
  qaResults: QAResult[];
  setQAResults: (r: QAResult[]) => void;
  showToast: (msg: string, variant: 'success' | 'danger' | 'info') => void;
}

function truncate(s: string, n = 40) {
  return s && s.length > n ? s.slice(0, n) + '...' : s || '';
}

function healthyDisplay(h: boolean | string | null | undefined): string {
  if (h === true || h === 'Yes') return 'Yes';
  if (h === false) return 'No';
  return String(h ?? '-');
}

export const QATab: React.FC<Props> = ({ qaResults, setQAResults, showToast }) => {
  const [qaType, setQaType] = useState<'1' | '2' | 'both'>('both');
  const [running, setRunning] = useState(false);

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
    try {
      const data = await api.qaResults();
      setQAResults(data.results);
      showToast(`Refreshed: ${data.count} QA result(s)`, 'success');
    } catch (e) {
      showToast(`Refresh failed: ${e}`, 'danger');
    }
  };

  return (
    <PageSection>
      <Split hasGutter style={{ marginBottom: 16, alignItems: 'center' }}>
        <SplitItem>
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
        </SplitItem>
        <SplitItem>
          <Button variant="primary" onClick={handleRun} isDisabled={running} isLoading={running}>
            Run QA
          </Button>
        </SplitItem>
        <SplitItem>
          <Button variant="secondary" onClick={handleRefresh}>Refresh</Button>
        </SplitItem>
        {qaResults.length > 0 && (
          <SplitItem>
            <Label color="blue">{qaResults.length} result(s)</Label>
          </SplitItem>
        )}
      </Split>

      {qaResults.length > 0 ? (
        <div style={{ overflowX: 'auto' }}>
          <Table aria-label="QA results" variant="compact">
            <Thead>
              <Tr>
                <Th>CI Name</Th>
                <Th>CI</Th>
                <Th>Status</Th>
                <Th>Deployed</Th>
                <Th>Healthy</Th>
                <Th>Seats</Th>
                <Th>Landing Page URL</Th>
              </Tr>
            </Thead>
            <Tbody>
              {qaResults.map((r, i) => (
                <Tr key={i}>
                  <Td dataLabel="CI Name">{r.ci_name}</Td>
                  <Td dataLabel="CI"><span className="truncated" title={r.ci}>{truncate(r.ci)}</span></Td>
                  <Td dataLabel="Status">{r.status}</Td>
                  <Td dataLabel="Deployed">{r.deployed || '-'}</Td>
                  <Td dataLabel="Healthy">{healthyDisplay(r.healthy)}</Td>
                  <Td dataLabel="Seats">{r.expected_seats ?? '-'} / {r.actual_seats ?? '-'}</Td>
                  <Td dataLabel="Landing Page URL">
                    {r.landing_page_url ? (
                      <a href={r.landing_page_url} target="_blank" rel="noopener noreferrer">
                        {truncate(r.landing_page_url, 50)}
                      </a>
                    ) : '-'}
                  </Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        </div>
      ) : (
        <EmptyState titleText="No QA results yet" headingLevel="h3" icon={SearchIcon}>
          <EmptyStateBody>Run QA above to verify your deployments.</EmptyStateBody>
        </EmptyState>
      )}
    </PageSection>
  );
};
