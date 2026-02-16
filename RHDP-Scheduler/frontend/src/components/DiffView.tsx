import { useState } from 'react';
import {
  Button,
  FileUpload,
  Split,
  SplitItem,
  Title,
  EmptyState,
  EmptyStateBody,
} from '@patternfly/react-core';
import { Table, Thead, Tbody, Tr, Th, Td } from '@patternfly/react-table';

import { api } from '../services/api';
import type { DiffResponse } from '../types';

interface Props {
  hasSchedules: boolean;
  showToast: (msg: string, variant: 'success' | 'danger' | 'info') => void;
}

export const DiffView: React.FC<Props> = ({ hasSchedules, showToast }) => {
  const [file, setFile] = useState<File | null>(null);
  const [filename, setFilename] = useState('');
  const [diff, setDiff] = useState<DiffResponse | null>(null);
  const [loading, setLoading] = useState(false);

  const handleCompare = async () => {
    if (!file) { showToast('Select a CSV file to compare', 'danger'); return; }
    setLoading(true);
    try {
      const result = await api.diffSchedules(file);
      setDiff(result);
      showToast(`Diff complete: ${result.added.length} added, ${result.removed.length} removed, ${result.changed.length} changed`, 'success');
    } catch (e) {
      showToast(`Diff failed: ${e}`, 'danger');
    } finally {
      setLoading(false);
    }
  };

  if (!hasSchedules) {
    return (
      <EmptyState titleText="No schedules loaded" headingLevel="h3">
        <EmptyStateBody>Upload a CSV first, then use Diff to compare against a new version.</EmptyStateBody>
      </EmptyState>
    );
  }

  return (
    <div style={{ marginTop: 16 }}>
      <Title headingLevel="h4" style={{ marginBottom: 8 }}>Compare Schedules</Title>
      <Split hasGutter style={{ marginBottom: 16, alignItems: 'center' }}>
        <SplitItem isFilled>
          <FileUpload
            id="diff-file-upload"
            filename={filename}
            filenamePlaceholder="Upload a new CSV to compare against current schedules"
            browseButtonText="Browse"
            clearButtonText="Clear"
            onFileInputChange={(_e, f) => { setFile(f); setFilename(f.name); }}
            onClearClick={() => { setFile(null); setFilename(''); setDiff(null); }}
            dropzoneProps={{ accept: { 'text/csv': ['.csv'] } }}
            hideDefaultPreview
          />
        </SplitItem>
        <SplitItem>
          <Button variant="secondary" onClick={handleCompare} isLoading={loading} isDisabled={loading || !file}>
            Compare
          </Button>
        </SplitItem>
      </Split>

      {diff && (
        <>
          <div style={{ display: 'flex', gap: 16, marginBottom: 12, fontSize: '0.85rem' }}>
            <span className="status-verified">+{diff.added.length} added</span>
            <span className="status-failed">-{diff.removed.length} removed</span>
            <span className="status-deployed_unverified">{diff.changed.length} changed</span>
            <span>{diff.unchanged} unchanged</span>
          </div>

          {(diff.added.length > 0 || diff.removed.length > 0 || diff.changed.length > 0) && (
            <Table aria-label="Schedule diff" variant="compact">
              <Thead>
                <Tr>
                  <Th>Change</Th>
                  <Th>CI Name</Th>
                  <Th>CI</Th>
                  <Th>Namespace</Th>
                  <Th>Details</Th>
                </Tr>
              </Thead>
              <Tbody>
                {diff.added.map((e, i) => (
                  <Tr key={`a-${i}`} className="diff-added">
                    <Td><span className="status-verified">Added</span></Td>
                    <Td>{e.ci_name}</Td>
                    <Td>{e.ci}</Td>
                    <Td>{e.namespace}</Td>
                    <Td>{e.details}</Td>
                  </Tr>
                ))}
                {diff.removed.map((e, i) => (
                  <Tr key={`r-${i}`} className="diff-removed">
                    <Td><span className="status-failed">Removed</span></Td>
                    <Td>{e.ci_name}</Td>
                    <Td>{e.ci}</Td>
                    <Td>{e.namespace}</Td>
                    <Td>{e.details}</Td>
                  </Tr>
                ))}
                {diff.changed.map((e, i) => (
                  <Tr key={`c-${i}`} className="diff-changed">
                    <Td><span className="status-deployed_unverified">Changed</span></Td>
                    <Td>{e.ci_name}</Td>
                    <Td>{e.ci}</Td>
                    <Td>{e.namespace}</Td>
                    <Td style={{ fontSize: '0.82rem', fontFamily: 'monospace' }}>{e.details}</Td>
                  </Tr>
                ))}
              </Tbody>
            </Table>
          )}
        </>
      )}
    </div>
  );
};
