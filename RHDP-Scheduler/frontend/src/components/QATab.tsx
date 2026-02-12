import { useState } from 'react';
import {
  Alert,
  Button,
  Card,
  CardBody,
  CardTitle,
  PageSection,
  Split,
  SplitItem,
  FormSelect,
  FormSelectOption,
  EmptyState,
  EmptyStateBody,
  Label,
  Title,
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
      {/* QA guidance */}
      <Alert variant="info" isInline isPlain title="When to use QA" style={{ marginBottom: 16 }}>
        Run QA checks after deploying workshops to verify they were created correctly and are healthy.
        <strong> QA1</strong> should be run immediately after deployment to confirm configuration.
        <strong> QA2</strong> should be run once workshops have had time to provision (typically 10-30 min) to verify health and collect student landing page URLs.
      </Alert>

      {/* QA type selector + run controls */}
      <Split hasGutter style={{ marginBottom: 16, alignItems: 'flex-start' }}>
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
              {qaType === '1' && 'Compares live workshops against your CSV schedule — checks dates, user counts, and configuration match what you uploaded.'}
              {qaType === '2' && 'Checks that workshops are actually provisioned and healthy, verifies seat counts, and retrieves student landing page URLs.'}
              {qaType === 'both' && 'Runs setup verification first, then checks deployment health and collects landing page URLs.'}
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

      {/* QA type explanation cards */}
      {qaResults.length === 0 && (
        <div className="ops-grid" style={{ marginBottom: 16 }}>
          <Card isCompact>
            <CardTitle>QA1 — Verify Setup</CardTitle>
            <CardBody style={{ fontSize: '0.85rem' }}>
              <p><strong>When:</strong> Immediately after deploying workshops.</p>
              <p><strong>What it checks:</strong></p>
              <ul style={{ margin: '4px 0 0', paddingLeft: 20 }}>
                <li>Workshop resources exist in the namespace</li>
                <li>Provisioning dates, auto-stop, and auto-destroy match the CSV</li>
                <li>User/seat counts match what was scheduled</li>
                <li>Workshop interface (UI) is enabled/disabled correctly</li>
              </ul>
              <p style={{ marginTop: 8 }}><strong>Result:</strong> Each workshop shows <span className="status-verified">verified</span> or <span className="status-failed">failed</span> with details on what mismatched.</p>
            </CardBody>
          </Card>
          <Card isCompact>
            <CardTitle>QA2 — Verify Deployment</CardTitle>
            <CardBody style={{ fontSize: '0.85rem' }}>
              <p><strong>When:</strong> 10-30 minutes after deployment, once workshops have provisioned.</p>
              <p><strong>What it checks:</strong></p>
              <ul style={{ margin: '4px 0 0', paddingLeft: 20 }}>
                <li>Workshops are actually deployed and running</li>
                <li>Health status of each workshop instance</li>
                <li>Expected vs actual seat counts</li>
                <li>Student landing page URLs are available</li>
              </ul>
              <p style={{ marginTop: 8 }}><strong>Result:</strong> Landing page URLs appear in the <strong>Students</strong> tab for distribution.</p>
            </CardBody>
          </Card>
        </div>
      )}

      {/* QA results table */}
      {qaResults.length > 0 ? (
        <>
          <Title headingLevel="h3" style={{ marginBottom: 8 }}>QA Results ({qaResults.length})</Title>
          <div className="table-scroll-wrapper">
          <Table aria-label="QA results" variant="compact" className="fixed-table">
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
                  <Td dataLabel="CI">{r.ci}</Td>
                  <Td dataLabel="Status"><span className={statusColorClass(r.status)}>{r.status}</span></Td>
                  <Td dataLabel="Deployed">{r.deployed || '-'}</Td>
                  <Td dataLabel="Healthy"><span className={healthyColorClass(r.healthy)}>{healthyDisplay(r.healthy)}</span></Td>
                  <Td dataLabel="Seats">{r.expected_seats ?? '-'} / {r.actual_seats ?? '-'}</Td>
                  <Td dataLabel="Landing Page URL">
                    {r.landing_page_url ? (
                      <a href={r.landing_page_url} target="_blank" rel="noopener noreferrer" className="cell-truncate" title={r.landing_page_url}>
                        {r.landing_page_url}
                      </a>
                    ) : '-'}
                  </Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
          </div>
        </>
      ) : (
        !qaResults.length && (
          <EmptyState titleText="No QA results yet" headingLevel="h3" icon={SearchIcon}>
            <EmptyStateBody>Select a QA type above and click Run QA after deploying your workshops.</EmptyStateBody>
          </EmptyState>
        )
      )}
    </PageSection>
  );
};
