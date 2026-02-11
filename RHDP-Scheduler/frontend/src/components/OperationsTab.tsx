import { useState, useMemo } from 'react';
import {
  Button,
  PageSection,
  Title,
  Card,
  CardBody,
  CardTitle,
  NumberInput,
  Select,
  SelectOption,
  SelectList,
  MenuToggle,
  Modal,
  ModalBody,
  ModalHeader,
  ModalFooter,
} from '@patternfly/react-core';
import { Table, Thead, Tbody, Tr, Th, Td } from '@patternfly/react-table';

import { api } from '../services/api';
import type { WorkshopSchedule } from '../types';

interface Props {
  showToast: (msg: string, variant: 'success' | 'danger' | 'info') => void;
  schedules: WorkshopSchedule[];
}

interface OpRecord {
  timestamp: string;
  operation: string;
  target: string;
  values: string;
  status: 'success' | 'failed';
  message: string;
}

/** Reusable CI filter dropdown for each operation card */
const CIFilter: React.FC<{
  options: string[];
  value: string;
  onChange: (val: string) => void;
  id: string;
}> = ({ options, value, onChange, id }) => {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div style={{ marginBottom: 12 }}>
      <label htmlFor={id} style={{ display: 'block', marginBottom: 4, fontSize: '0.85rem', fontWeight: 600 }}>
        Target
      </label>
      <Select
        id={id}
        isOpen={isOpen}
        selected={value}
        onSelect={(_e, val) => { onChange(val as string); setIsOpen(false); }}
        onOpenChange={setIsOpen}
        toggle={(toggleRef) => (
          <MenuToggle
            ref={toggleRef}
            onClick={() => setIsOpen(prev => !prev)}
            isExpanded={isOpen}
            isFullWidth
          >
            {value || 'All Catalog Items'}
          </MenuToggle>
        )}
        shouldFocusToggleOnSelect
      >
        <SelectList>
          <SelectOption value="">All Catalog Items</SelectOption>
          {options.map(ci => (
            <SelectOption key={ci} value={ci}>{ci}</SelectOption>
          ))}
        </SelectList>
      </Select>
    </div>
  );
};

export const OperationsTab: React.FC<Props> = ({ showToast, schedules }) => {
  const [lockFilter, setLockFilter] = useState('');
  const [extStopFilter, setExtStopFilter] = useState('');
  const [extStopDays, setExtStopDays] = useState(0);
  const [extStopHours, setExtStopHours] = useState(0);
  const [extDestroyFilter, setExtDestroyFilter] = useState('');
  const [extDestroyDays, setExtDestroyDays] = useState(0);
  const [extDestroyHours, setExtDestroyHours] = useState(0);
  const [scaleFilter, setScaleFilter] = useState('');
  const [scaleCount, setScaleCount] = useState(20);
  const [history, setHistory] = useState<OpRecord[]>([]);

  // Loading states
  const [lockLoading, setLockLoading] = useState(false);
  const [extStopLoading, setExtStopLoading] = useState(false);
  const [extDestroyLoading, setExtDestroyLoading] = useState(false);
  const [scaleLoading, setScaleLoading] = useState(false);

  // Lock confirmation modal
  const [showLockConfirm, setShowLockConfirm] = useState(false);

  const ciOptions = useMemo(() => {
    const unique = new Set(schedules.map(s => s.ci));
    return Array.from(unique).sort();
  }, [schedules]);

  const addRecord = (operation: string, target: string, values: string, success: boolean, message: string) => {
    setHistory(prev => [{
      timestamp: new Date().toLocaleTimeString(),
      operation,
      target: target || 'All',
      values,
      status: success ? 'success' : 'failed',
      message,
    }, ...prev]);
  };

  const handleLock = async () => {
    setShowLockConfirm(false);
    setLockLoading(true);
    try {
      const r = await api.lock({ ci_filter: lockFilter || undefined });
      addRecord('Lock', lockFilter, '--', r.success, r.message);
      showToast(r.message, r.success ? 'success' : 'danger');
    } catch (e) {
      addRecord('Lock', lockFilter, '--', false, String(e));
      showToast(`Lock failed: ${e}`, 'danger');
    } finally {
      setLockLoading(false);
    }
  };

  const handleExtendStop = async () => {
    if (extStopDays === 0 && extStopHours === 0) { showToast('Specify days or hours', 'danger'); return; }
    const vals = `${extStopDays}d ${extStopHours}h`;
    setExtStopLoading(true);
    try {
      const r = await api.extendStop({ days: extStopDays, hours: extStopHours, ci_filter: extStopFilter || undefined });
      addRecord('Extend Stop', extStopFilter, vals, r.success, r.message);
      showToast(r.message, r.success ? 'success' : 'danger');
    } catch (e) {
      addRecord('Extend Stop', extStopFilter, vals, false, String(e));
      showToast(`Extend stop failed: ${e}`, 'danger');
    } finally {
      setExtStopLoading(false);
    }
  };

  const handleExtendDestroy = async () => {
    if (extDestroyDays === 0 && extDestroyHours === 0) { showToast('Specify days or hours', 'danger'); return; }
    const vals = `${extDestroyDays}d ${extDestroyHours}h`;
    setExtDestroyLoading(true);
    try {
      const r = await api.extendDestroy({ days: extDestroyDays, hours: extDestroyHours, ci_filter: extDestroyFilter || undefined });
      addRecord('Extend Destroy', extDestroyFilter, vals, r.success, r.message);
      showToast(r.message, r.success ? 'success' : 'danger');
    } catch (e) {
      addRecord('Extend Destroy', extDestroyFilter, vals, false, String(e));
      showToast(`Extend destroy failed: ${e}`, 'danger');
    } finally {
      setExtDestroyLoading(false);
    }
  };

  const handleScale = async () => {
    const vals = `count: ${scaleCount}`;
    setScaleLoading(true);
    try {
      const r = await api.scale({ target_count: scaleCount, ci_filter: scaleFilter || undefined });
      addRecord('Scale', scaleFilter, vals, r.success, r.message);
      showToast(r.message, r.success ? 'success' : 'danger');
    } catch (e) {
      addRecord('Scale', scaleFilter, vals, false, String(e));
      showToast(`Scale failed: ${e}`, 'danger');
    } finally {
      setScaleLoading(false);
    }
  };

  return (
    <PageSection>
      <div className="ops-grid" style={{ marginBottom: 16 }}>
        {/* Lock */}
        <Card isFullHeight>
          <CardTitle>Lock Workshops</CardTitle>
          <CardBody>
            <CIFilter options={ciOptions} value={lockFilter} onChange={setLockFilter} id="lock-ci-filter" />
            <p style={{ marginBottom: 8, fontSize: '0.85rem' }}>Set stop time to now (immediate shutdown).</p>
            <Button
              variant="danger"
              onClick={() => setShowLockConfirm(true)}
              isLoading={lockLoading}
              isDisabled={lockLoading}
            >
              Lock
            </Button>
          </CardBody>
        </Card>

        {/* Extend Stop */}
        <Card isFullHeight>
          <CardTitle>Extend Stop Time</CardTitle>
          <CardBody>
            <CIFilter options={ciOptions} value={extStopFilter} onChange={setExtStopFilter} id="ext-stop-ci-filter" />
            <div className="ops-number-row">
              <NumberInput
                value={extStopDays}
                min={0}
                onMinus={() => setExtStopDays(Math.max(0, extStopDays - 1))}
                onPlus={() => setExtStopDays(extStopDays + 1)}
                onChange={(e) => setExtStopDays(Math.max(0, Number((e.target as HTMLInputElement).value)))}
                widthChars={3}
                aria-label="Days"
              />
              <span>days</span>
              <NumberInput
                value={extStopHours}
                min={0}
                onMinus={() => setExtStopHours(Math.max(0, extStopHours - 1))}
                onPlus={() => setExtStopHours(extStopHours + 1)}
                onChange={(e) => setExtStopHours(Math.max(0, Number((e.target as HTMLInputElement).value)))}
                widthChars={3}
                aria-label="Hours"
              />
              <span>hours</span>
            </div>
            <Button
              variant="primary"
              onClick={handleExtendStop}
              isLoading={extStopLoading}
              isDisabled={extStopLoading}
            >
              Extend Stop
            </Button>
          </CardBody>
        </Card>

        {/* Extend Destroy */}
        <Card isFullHeight>
          <CardTitle>Extend Destroy Time</CardTitle>
          <CardBody>
            <CIFilter options={ciOptions} value={extDestroyFilter} onChange={setExtDestroyFilter} id="ext-destroy-ci-filter" />
            <div className="ops-number-row">
              <NumberInput
                value={extDestroyDays}
                min={0}
                onMinus={() => setExtDestroyDays(Math.max(0, extDestroyDays - 1))}
                onPlus={() => setExtDestroyDays(extDestroyDays + 1)}
                onChange={(e) => setExtDestroyDays(Math.max(0, Number((e.target as HTMLInputElement).value)))}
                widthChars={3}
                aria-label="Days"
              />
              <span>days</span>
              <NumberInput
                value={extDestroyHours}
                min={0}
                onMinus={() => setExtDestroyHours(Math.max(0, extDestroyHours - 1))}
                onPlus={() => setExtDestroyHours(extDestroyHours + 1)}
                onChange={(e) => setExtDestroyHours(Math.max(0, Number((e.target as HTMLInputElement).value)))}
                widthChars={3}
                aria-label="Hours"
              />
              <span>hours</span>
            </div>
            <Button
              variant="primary"
              onClick={handleExtendDestroy}
              isLoading={extDestroyLoading}
              isDisabled={extDestroyLoading}
            >
              Extend Destroy
            </Button>
          </CardBody>
        </Card>

        {/* Scale */}
        <Card isFullHeight>
          <CardTitle>Scale Workshops</CardTitle>
          <CardBody>
            <CIFilter options={ciOptions} value={scaleFilter} onChange={setScaleFilter} id="scale-ci-filter" />
            <div className="ops-number-row">
              <NumberInput
                value={scaleCount}
                min={0}
                onMinus={() => setScaleCount(Math.max(0, scaleCount - 1))}
                onPlus={() => setScaleCount(scaleCount + 1)}
                onChange={(e) => setScaleCount(Math.max(0, Number((e.target as HTMLInputElement).value)))}
                widthChars={4}
                aria-label="Target count"
              />
              <span>target count</span>
            </div>
            <Button
              variant="primary"
              onClick={handleScale}
              isLoading={scaleLoading}
              isDisabled={scaleLoading}
            >
              Scale
            </Button>
          </CardBody>
        </Card>
      </div>

      {/* Operations History Table */}
      <Title headingLevel="h3" style={{ marginBottom: 8 }}>Operations History</Title>
      {history.length > 0 ? (
        <Table aria-label="Operations history" variant="compact">
          <Thead>
            <Tr>
              <Th>Time</Th>
              <Th>Operation</Th>
              <Th>Target CI</Th>
              <Th>Values</Th>
              <Th>Status</Th>
              <Th>Message</Th>
            </Tr>
          </Thead>
          <Tbody>
            {history.map((rec, i) => (
              <Tr key={i}>
                <Td dataLabel="Time">{rec.timestamp}</Td>
                <Td dataLabel="Operation">{rec.operation}</Td>
                <Td dataLabel="Target CI">{rec.target}</Td>
                <Td dataLabel="Values">{rec.values}</Td>
                <Td dataLabel="Status">
                  <span className={rec.status === 'success' ? 'status-verified' : 'status-failed'}>
                    {rec.status}
                  </span>
                </Td>
                <Td dataLabel="Message">{rec.message}</Td>
              </Tr>
            ))}
          </Tbody>
        </Table>
      ) : (
        <div className="log-box">No operations yet.</div>
      )}

      {/* Lock confirmation modal */}
      <Modal
        variant="small"
        isOpen={showLockConfirm}
        onClose={() => setShowLockConfirm(false)}
        aria-labelledby="lock-confirm-title"
      >
        <ModalHeader title="Confirm Lock" labelId="lock-confirm-title" titleIconVariant="warning" />
        <ModalBody>
          This will immediately shut down workshops{lockFilter ? ` for "${lockFilter}"` : ''} by setting the stop time to now. <strong>This cannot be undone.</strong>
        </ModalBody>
        <ModalFooter>
          <Button variant="danger" onClick={handleLock}>Lock Now</Button>
          <Button variant="link" onClick={() => setShowLockConfirm(false)}>Cancel</Button>
        </ModalFooter>
      </Modal>
    </PageSection>
  );
};
