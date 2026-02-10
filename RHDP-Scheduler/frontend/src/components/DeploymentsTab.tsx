import {
  Button,
  PageSection,
  Title,
  Split,
  SplitItem,
  EmptyState,
  EmptyStateBody,
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

export const DeploymentsTab: React.FC<Props> = ({ results, setResults, showToast }) => {
  const handleRefresh = async () => {
    try {
      const r = await api.deployResults();
      setResults(r);
      showToast(`Refreshed: ${r.length} result(s)`, 'success');
    } catch (e) {
      showToast(`Refresh failed: ${e}`, 'danger');
    }
  };

  return (
    <PageSection>
      <Split hasGutter style={{ marginBottom: 16, alignItems: 'center' }}>
        <SplitItem>
          <Title headingLevel="h3">Deployment Results ({results.length})</Title>
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

      {results.length > 0 ? (
        <Table aria-label="Deployment results" variant="compact" className="fixed-table">
          <Thead>
            <Tr>
              <Th width={10}>CI Name</Th>
              <Th width={15}>CI</Th>
              <Th width={15}>GUID</Th>
              <Th width={10}>Status</Th>
              <Th width={20}>URL</Th>
              <Th width={10}>Prov. Date</Th>
              <Th width={10}>Timestamp</Th>
              <Th width={10}>Error</Th>
            </Tr>
          </Thead>
          <Tbody>
            {results.map((r, i) => (
              <Tr key={i}>
                <Td dataLabel="CI Name">{r.ci_name}</Td>
                <Td dataLabel="CI"><span className="cell-truncate" title={r.ci}>{r.ci}</span></Td>
                <Td dataLabel="GUID"><span className="cell-truncate" title={r.guid}>{r.guid}</span></Td>
                <Td dataLabel="Status"><span className={statusClass(r.status)}>{formatStatus(r.status)}</span></Td>
                <Td dataLabel="URL">
                  {r.url ? (
                    <a className="cell-truncate" href={r.url} target="_blank" rel="noopener noreferrer" title={r.url}>
                      {r.url}
                    </a>
                  ) : '-'}
                </Td>
                <Td dataLabel="Prov. Date">{r.provisioning_date}</Td>
                <Td dataLabel="Timestamp">{r.timestamp}</Td>
                <Td dataLabel="Error">
                  {r.error_message ? <span className="cell-truncate" title={r.error_message}>{r.error_message}</span> : ''}
                </Td>
              </Tr>
            ))}
          </Tbody>
        </Table>
      ) : (
        <EmptyState titleText="No deployment results yet" headingLevel="h3" icon={CubesIcon}>
          <EmptyStateBody>Deploy schedules from the Upload tab to see results here.</EmptyStateBody>
        </EmptyState>
      )}
    </PageSection>
  );
};
