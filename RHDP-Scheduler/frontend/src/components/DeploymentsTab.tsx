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

function truncate(s: string, n = 40) {
  return s && s.length > n ? s.slice(0, n) + '...' : s || '';
}

function statusClass(status: string) {
  if (!status) return '';
  const s = status.toLowerCase().replace(/[^a-z_]/g, '');
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
        <div style={{ overflowX: 'auto' }}>
          <Table aria-label="Deployment results" variant="compact">
            <Thead>
              <Tr>
                <Th>CI Name</Th>
                <Th>CI</Th>
                <Th>GUID</Th>
                <Th>Status</Th>
                <Th>URL</Th>
                <Th>Prov. Date</Th>
                <Th>Timestamp</Th>
                <Th>Error</Th>
              </Tr>
            </Thead>
            <Tbody>
              {results.map((r, i) => (
                <Tr key={i}>
                  <Td dataLabel="CI Name">{r.ci_name}</Td>
                  <Td dataLabel="CI"><span className="truncated" title={r.ci}>{truncate(r.ci)}</span></Td>
                  <Td dataLabel="GUID">{r.guid}</Td>
                  <Td dataLabel="Status"><span className={statusClass(r.status)}>{r.status}</span></Td>
                  <Td dataLabel="URL">
                    {r.url ? <a href={r.url} target="_blank" rel="noopener noreferrer">{truncate(r.url, 50)}</a> : '-'}
                  </Td>
                  <Td dataLabel="Prov. Date">{r.provisioning_date}</Td>
                  <Td dataLabel="Timestamp">{r.timestamp}</Td>
                  <Td dataLabel="Error"><span className="truncated" title={r.error_message}>{truncate(r.error_message, 30)}</span></Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        </div>
      ) : (
        <EmptyState titleText="No deployment results yet" headingLevel="h3" icon={CubesIcon}>
          <EmptyStateBody>Deploy schedules from the Upload tab to see results here.</EmptyStateBody>
        </EmptyState>
      )}
    </PageSection>
  );
};
