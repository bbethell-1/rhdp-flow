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

function healthyDisplay(h: boolean | string | null | undefined): string {
  if (h === true || h === 'Yes') return 'Yes';
  if (h === false) return 'No';
  return String(h ?? '-');
}

function statusColorClass(status: string): string {
  if (!status) return '';
  const s = status.toLowerCase();
  if (s.includes('verified') && !s.includes('unverified')) return 'status-verified';
  if (s.includes('failed') || s.includes('error')) return 'status-failed';
  return '';
}

function healthyColorClass(h: boolean | string | null | undefined): string {
  if (h === true || h === 'Yes') return 'status-verified';
  if (h === false || h === 'No') return 'status-failed';
  return '';
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
              {qaType === '1' && 'Checks workshops are created with correct config (seats, UI, passwords)'}
              {qaType === '2' && 'Checks deployment health, readiness, and landing page URLs'}
              {qaType === 'both' && 'Runs both setup verification and deployment health checks'}
            </p>
          </div>
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
        <Table aria-label="QA results" variant="compact" className="fixed-table">
          <Thead>
            <Tr>
              <Th width={15}>CI Name</Th>
              <Th width={20}>CI</Th>
              <Th width={10}>Status</Th>
              <Th width={10}>Deployed</Th>
              <Th width={10}>Healthy</Th>
              <Th width={10}>Seats</Th>
              <Th width={25}>Landing Page URL</Th>
            </Tr>
          </Thead>
          <Tbody>
            {qaResults.map((r, i) => (
              <Tr key={i}>
                <Td dataLabel="CI Name">{r.ci_name}</Td>
                <Td dataLabel="CI"><span className="cell-truncate" title={r.ci}>{r.ci}</span></Td>
                <Td dataLabel="Status"><span className={statusColorClass(r.status)}>{r.status}</span></Td>
                <Td dataLabel="Deployed">{r.deployed || '-'}</Td>
                <Td dataLabel="Healthy"><span className={healthyColorClass(r.healthy)}>{healthyDisplay(r.healthy)}</span></Td>
                <Td dataLabel="Seats">{r.expected_seats ?? '-'} / {r.actual_seats ?? '-'}</Td>
                <Td dataLabel="Landing Page URL">
                  {r.landing_page_url ? (
                    <a className="cell-truncate" href={r.landing_page_url} target="_blank" rel="noopener noreferrer" title={r.landing_page_url}>
                      {r.landing_page_url}
                    </a>
                  ) : '-'}
                </Td>
              </Tr>
            ))}
          </Tbody>
        </Table>
      ) : (
        <EmptyState titleText="No QA results yet" headingLevel="h3" icon={SearchIcon}>
          <EmptyStateBody>Run QA above to verify your deployments.</EmptyStateBody>
        </EmptyState>
      )}
    </PageSection>
  );
};
