import { useState, useMemo, useEffect } from 'react';
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
  const [history, setHistory] = useState<OpRecord[]>(() => {
    try {
      const saved = sessionStorage.getItem('rhdp-ops-history');
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  });

  // Persist operations history to sessionStorage
  useEffect(() => {
    try { sessionStorage.setItem('rhdp-ops-history', JSON.stringify(history)); } catch { /* ignore */ }
  }, [history]);

  // Loading states
  const [lockLoading, setLockLoading] = useState(false);
  const [unlockLoading, setUnlockLoading] = useState(false);
  const [extStopLoading, setExtStopLoading] = useState(false);
  const [extDestroyLoading, setExtDestroyLoading] = useState(false);
  const [scaleLoading, setScaleLoading] = useState(false);

  // Lock / Unlock confirmation modals
  const [showLockConfirm, setShowLockConfirm] = useState(false);
  const [showUnlockConfirm, setShowUnlockConfirm] = useState(false);

  // Scale-to-zero confirmation modal
  const [showScaleZeroConfirm, setShowScaleZeroConfirm] = useState(false);

  const ciOptions = useMemo(() => {
    const unique = new Set(schedules.map(s => s.ci));
    return Array.from(unique).sort();
  }, [schedules]);

  /** Compute extend preview: earliest current date -> new date after adding days/hours */
  const extendPreview = (filter: string, field: 'auto_stop' | 'auto_destroy', days: number, hours: number) => {
    const targets = filter ? schedules.filter(s => s.ci === filter) : schedules;
    if (targets.length === 0 || (days === 0 && hours === 0)) return null;
    // Find the earliest date to show as representative
    const dates = targets
      .map(s => s[field])
      .filter(Boolean)
      .sort();
    if (dates.length === 0) return null;
    const current = dates[0];
    // Try to compute new date
    const parsed = new Date(
      current.replace(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})\s+(\d{1,2}):(\d{2})$/,
        (_m, d, mo, y, h, mi) => {
          const yr = y.length === 2 ? `20${y}` : y;
          return `${yr}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}T${h.padStart(2, '0')}:${mi}`;
        })
    );
    if (isNaN(parsed.getTime())) return null;
    const newDate = new Date(parsed.getTime() + (days * 24 + hours) * 3600_000);
    const fmt = (d: Date) => d.toLocaleString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
    const label = dates.length > 1 ? ` (earliest of ${dates.length})` : '';
    return `${fmt(parsed)}${label} → ${fmt(newDate)}`;
  };

  const stopPreview = extendPreview(extStopFilter, 'auto_stop', extStopDays, extStopHours);
  const destroyPreview = extendPreview(extDestroyFilter, 'auto_destroy', extDestroyDays, extDestroyHours);

  /** How many workshops the current lock filter would affect */
  const lockAffectedCount = useMemo(() => {
    if (!lockFilter) return schedules.length;
    return schedules.filter(s => s.ci === lockFilter).length;
  }, [schedules, lockFilter]);

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

  const handleUnlock = async () => {
    setShowUnlockConfirm(false);
    setUnlockLoading(true);
    try {
      const r = await api.unlock({ ci_filter: lockFilter || undefined });
      addRecord('Unlock', lockFilter, '--', r.success, r.message);
      showToast(r.message, r.success ? 'success' : 'danger');
    } catch (e) {
      addRecord('Unlock', lockFilter, '--', false, String(e));
      showToast(`Unlock failed: ${e}`, 'danger');
    } finally {
      setUnlockLoading(false);
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
    // Intercept scale-to-zero
    if (scaleCount === 0 && !showScaleZeroConfirm) {
      setShowScaleZeroConfirm(true);
      return;
    }
    setShowScaleZeroConfirm(false);
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
        {/* Resource Lock */}
        <Card isFullHeight>
          <CardTitle>Resource Lock</CardTitle>
          <CardBody>
            <CIFilter options={ciOptions} value={lockFilter} onChange={setLockFilter} id="lock-ci-filter" />
            <p style={{ marginBottom: 8, fontSize: '0.85rem' }}>
              Toggle the <code>demo.redhat.com/resource-lock</code> label on existing workshops.
              When locked, non-admin users cannot make changes in the RHDP UI.
            </p>
            <div style={{ display: 'flex', gap: 8 }}>
              <Button
                variant="warning"
                onClick={() => setShowLockConfirm(true)}
                isLoading={lockLoading}
                isDisabled={lockLoading || unlockLoading}
              >
                Lock
              </Button>
              <Button
                variant="secondary"
                onClick={() => setShowUnlockConfirm(true)}
                isLoading={unlockLoading}
                isDisabled={lockLoading || unlockLoading}
              >
                Unlock
              </Button>
            </div>
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
            {stopPreview && (
              <p className="ops-preview">{stopPreview}</p>
            )}
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
            {destroyPreview && (
              <p className="ops-preview">{destroyPreview}</p>
            )}
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
          <p>
            This will set the <code>demo.redhat.com/resource-lock</code> label to <strong>true</strong> on{' '}
            {lockAffectedCount > 0 ? <strong>{lockAffectedCount} workshop(s)</strong> : 'workshops'}
            {lockFilter ? <> matching <strong>"{lockFilter}"</strong></> : <> (<strong>all catalog items</strong>)</>}.
          </p>
          <p style={{ marginTop: 8 }}>Non-admin users will not be able to modify these resources in the RHDP UI.</p>
        </ModalBody>
        <ModalFooter>
          <Button variant="warning" onClick={handleLock}>Lock</Button>
          <Button variant="link" onClick={() => setShowLockConfirm(false)}>Cancel</Button>
        </ModalFooter>
      </Modal>

      {/* Unlock confirmation modal */}
      <Modal
        variant="small"
        isOpen={showUnlockConfirm}
        onClose={() => setShowUnlockConfirm(false)}
        aria-labelledby="unlock-confirm-title"
      >
        <ModalHeader title="Confirm Unlock" labelId="unlock-confirm-title" />
        <ModalBody>
          <p>
            This will set the <code>demo.redhat.com/resource-lock</code> label to <strong>false</strong> on{' '}
            {lockAffectedCount > 0 ? <strong>{lockAffectedCount} workshop(s)</strong> : 'workshops'}
            {lockFilter ? <> matching <strong>"{lockFilter}"</strong></> : <> (<strong>all catalog items</strong>)</>}.
          </p>
          <p style={{ marginTop: 8 }}>Non-admin users will be able to modify these resources again.</p>
        </ModalBody>
        <ModalFooter>
          <Button variant="primary" onClick={handleUnlock}>Unlock</Button>
          <Button variant="link" onClick={() => setShowUnlockConfirm(false)}>Cancel</Button>
        </ModalFooter>
      </Modal>

      {/* Scale-to-zero confirmation modal */}
      <Modal
        variant="small"
        isOpen={showScaleZeroConfirm}
        onClose={() => setShowScaleZeroConfirm(false)}
        aria-labelledby="scale-zero-title"
      >
        <ModalHeader title="Confirm Scale to Zero" labelId="scale-zero-title" titleIconVariant="warning" />
        <ModalBody>
          Scaling to <strong>0</strong> will remove all workshop instances
          {scaleFilter ? <> for <strong>"{scaleFilter}"</strong></> : ''}.
          This will destroy all running resources. Continue?
        </ModalBody>
        <ModalFooter>
          <Button variant="danger" onClick={handleScale}>Scale to Zero</Button>
          <Button variant="link" onClick={() => setShowScaleZeroConfirm(false)}>Cancel</Button>
        </ModalFooter>
      </Modal>
    </PageSection>
  );
};
