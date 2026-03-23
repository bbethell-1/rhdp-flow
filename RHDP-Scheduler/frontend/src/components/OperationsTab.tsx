import { useState, useMemo, useEffect } from 'react';
import {
  Button,
  EmptyState,
  EmptyStateBody,
  Label,
  PageSection,
  SearchInput,
  Split,
  SplitItem,
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
  Tooltip,
} from '@patternfly/react-core';
import { Table, Thead, Tbody, Tr, Th, Td } from '@patternfly/react-table';

import { api } from '../services/api';
import { statusIcon } from '../utils/statusColors';
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
  const [noAutostopFilter, setNoAutostopFilter] = useState('');
  const [scaleFilter, setScaleFilter] = useState('');
  const [scaleCount, setScaleCount] = useState(20);
  const [history, setHistory] = useState<OpRecord[]>(() => {
    try {
      const saved = sessionStorage.getItem('rhdp-ops-history');
      return saved ? JSON.parse(saved) : [];
    } catch (e) { console.warn('Failed to load ops history from sessionStorage', e); return []; }
  });

  // Persist operations history to sessionStorage
  useEffect(() => {
    try { sessionStorage.setItem('rhdp-ops-history', JSON.stringify(history)); } catch (e) { console.warn('Failed to persist ops history', e); }
  }, [history]);

  // Loading states
  const [lockLoading, setLockLoading] = useState(false);
  const [unlockLoading, setUnlockLoading] = useState(false);
  const [extStopLoading, setExtStopLoading] = useState(false);
  const [extDestroyLoading, setExtDestroyLoading] = useState(false);
  const [noAutostopLoading, setNoAutostopLoading] = useState(false);
  const [scaleLoading, setScaleLoading] = useState(false);
  const [showroomCleanupLoading, setShowroomCleanupLoading] = useState(false);
  const [showroomHealthLoading, setShowroomHealthLoading] = useState(false);
  const [showroomPreflightLoading, setShowroomPreflightLoading] = useState(false);

  // Lock / Unlock confirmation modals
  const [showLockConfirm, setShowLockConfirm] = useState(false);
  const [showUnlockConfirm, setShowUnlockConfirm] = useState(false);

  // Scale-to-zero confirmation modal
  const [showScaleZeroConfirm, setShowScaleZeroConfirm] = useState(false);

  // Extend confirmation modals
  const [showExtStopConfirm, setShowExtStopConfirm] = useState(false);
  const [showExtDestroyConfirm, setShowExtDestroyConfirm] = useState(false);

  // Disable auto-stop confirmation modal
  const [showNoAutostopConfirm, setShowNoAutostopConfirm] = useState(false);

  // Showroom states
  const [showroomFilter, setShowroomFilter] = useState('');
  const [showShowroomCleanupConfirm, setShowShowroomCleanupConfirm] = useState(false);

  // History search
  const [historySearch, setHistorySearch] = useState('');

  const filteredHistory = useMemo(() => {
    if (!historySearch) return history;
    const q = historySearch.toLowerCase();
    return history.filter(r =>
      r.operation.toLowerCase().includes(q) ||
      r.target.toLowerCase().includes(q) ||
      r.message.toLowerCase().includes(q) ||
      r.values.toLowerCase().includes(q)
    );
  }, [history, historySearch]);

  const ciOptions = useMemo(() => {
    const unique = new Set(schedules.map(s => s.ci));
    return Array.from(unique).sort();
  }, [schedules]);

  /** U1: Count schedules with Showroom repos configured */
  const showroomScheduleCount = useMemo(
    () => schedules.filter(s => s.showroom_repo).length,
    [schedules],
  );

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
          return `${yr}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}T${h.padStart(2, '0')}:${mi}:00Z`;
        })
    );
    if (isNaN(parsed.getTime())) return null;
    const newDate = new Date(parsed.getTime() + (days * 24 + hours) * 3600_000);
    const fmt = (d: Date) => d.toLocaleString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'UTC' }) + ' UTC';
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
      timestamp: new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'UTC' }) + ' UTC',
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
    if (!showExtStopConfirm) { setShowExtStopConfirm(true); return; }
    setShowExtStopConfirm(false);
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
    if (!showExtDestroyConfirm) { setShowExtDestroyConfirm(true); return; }
    setShowExtDestroyConfirm(false);
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

  const handleDisableAutostop = async () => {
    if (!showNoAutostopConfirm) { setShowNoAutostopConfirm(true); return; }
    setShowNoAutostopConfirm(false);
    setNoAutostopLoading(true);
    try {
      const r = await api.disableAutostop({ ci_filter: noAutostopFilter || undefined });
      addRecord('Disable Auto-Stop', noAutostopFilter, '--', r.success, r.message);
      showToast(r.message, r.success ? 'success' : 'danger');
    } catch (e) {
      addRecord('Disable Auto-Stop', noAutostopFilter, '--', false, String(e));
      showToast(`Disable auto-stop failed: ${e}`, 'danger');
    } finally {
      setNoAutostopLoading(false);
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

  const handleShowroomCleanup = async () => {
    if (!showShowroomCleanupConfirm) { setShowShowroomCleanupConfirm(true); return; }
    setShowShowroomCleanupConfirm(false);
    setShowroomCleanupLoading(true);
    try {
      const r = await api.showroomCleanup({ ci_filter: showroomFilter || undefined });
      const msg = r.details?.length ? `${r.message} | ${r.details.join('; ')}` : r.message;
      addRecord('Showroom Cleanup', showroomFilter, '--', r.success, msg);
      showToast(r.message, r.success ? 'success' : 'danger');
    } catch (e) {
      addRecord('Showroom Cleanup', showroomFilter, '--', false, String(e));
      showToast(`Showroom cleanup failed: ${e}`, 'danger');
    } finally {
      setShowroomCleanupLoading(false);
    }
  };

  const handleShowroomHealth = async () => {
    setShowroomHealthLoading(true);
    try {
      const r = await api.showroomHealth({ ci_filter: showroomFilter || undefined });
      const msg = r.details?.length ? `${r.message} | ${r.details.join('; ')}` : r.message;
      addRecord('Showroom Health', showroomFilter, '--', r.success, msg);
      showToast(r.message, r.success ? 'success' : 'danger');
    } catch (e) {
      addRecord('Showroom Health', showroomFilter, '--', false, String(e));
      showToast(`Showroom health check failed: ${e}`, 'danger');
    } finally {
      setShowroomHealthLoading(false);
    }
  };

  const handleShowroomPreflight = async () => {
    setShowroomPreflightLoading(true);
    try {
      const r = await api.showroomPreflight({ ci_filter: showroomFilter || undefined });
      const msg = r.details?.length ? `${r.message} | ${r.details.join('; ')}` : r.message;
      addRecord('Demolition Preflight', showroomFilter, '--', r.success, msg);
      showToast(r.message, r.success ? 'success' : 'danger');
    } catch (e) {
      const errStr = e instanceof Error ? e.message : String(e);
      addRecord('Demolition Preflight', showroomFilter, '--', false, errStr);
      showToast(`Preflight failed: ${errStr}`, 'danger');
    } finally {
      setShowroomPreflightLoading(false);
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
              Toggle the <code>demo.redhat.com/lock-enabled</code> label on existing workshops.
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
          <CardTitle><Tooltip content="Push back the time when workshops automatically stop running. Workshops can be restarted after stop."><span>Extend Stop Time</span></Tooltip></CardTitle>
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
          <CardTitle><Tooltip content="Push back the time when workshop resources are permanently destroyed and cleaned up. This cannot be reversed after the deadline."><span>Extend Destroy Time</span></Tooltip></CardTitle>
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

        {/* Disable Auto-Stop */}
        <Card isFullHeight>
          <CardTitle>
            <Tooltip content="Remove the auto-stop schedule so workshops keep running until manually stopped or destroyed.">
              <span>Disable Auto-Stop</span>
            </Tooltip>
          </CardTitle>
          <CardBody>
            <CIFilter options={ciOptions} value={noAutostopFilter} onChange={setNoAutostopFilter} id="no-autostop-ci-filter" />
            <p style={{ marginBottom: 8, fontSize: '0.85rem' }}>
              Clears <code>actionSchedule.stop</code> so workshops remain running until their destroy deadline or manual intervention.
            </p>
            <Button
              variant="warning"
              onClick={handleDisableAutostop}
              isLoading={noAutostopLoading}
              isDisabled={noAutostopLoading}
            >
              Disable Auto-Stop
            </Button>
          </CardBody>
        </Card>

        {/* Scale */}
        <Card isFullHeight>
          <CardTitle><Tooltip content="Change the number of running workshop seat instances. Scale to 0 to remove all instances."><span>Scale Workshops</span></Tooltip></CardTitle>
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
              <Tooltip content="Number of workshop seat instances to provision"><span>target count</span></Tooltip>
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

        {/* Showroom Lab Environment */}
        <Card isFullHeight>
          <CardTitle>
            <Tooltip content="Manage Showroom lab environments — check health or clean up resources for workshops with Showroom repos configured.">
              <span>Showroom Labs</span>
            </Tooltip>
            {showroomScheduleCount > 0 && (
              <Label color="blue" isCompact style={{ marginLeft: 8 }}>{showroomScheduleCount} configured</Label>
            )}
          </CardTitle>
          <CardBody>
            <CIFilter options={ciOptions} value={showroomFilter} onChange={setShowroomFilter} id="showroom-ci-filter" />
            <p style={{ marginBottom: 8, fontSize: '0.85rem' }}>
              Health Check verifies pods and routes via <code>oc</code>.
              Preflight uses <a href="https://github.com/rhpds/demolition" target="_blank" rel="noopener noreferrer">Demolition</a> to
              browser-test deployed workshop URLs.
            </p>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <Button
                variant="primary"
                onClick={handleShowroomHealth}
                isLoading={showroomHealthLoading}
                isDisabled={showroomHealthLoading || showroomCleanupLoading || showroomPreflightLoading}
              >
                Health Check
              </Button>
              <Tooltip content="Run Demolition preflight — opens each workshop URL in a headless browser to verify page loads correctly. Requires deployment results.">
                <Button
                  variant="secondary"
                  onClick={handleShowroomPreflight}
                  isLoading={showroomPreflightLoading}
                  isDisabled={showroomHealthLoading || showroomCleanupLoading || showroomPreflightLoading}
                >
                  Preflight (Demolition)
                </Button>
              </Tooltip>
              <Button
                variant="danger"
                onClick={handleShowroomCleanup}
                isLoading={showroomCleanupLoading}
                isDisabled={showroomHealthLoading || showroomCleanupLoading || showroomPreflightLoading}
              >
                Cleanup
              </Button>
            </div>
          </CardBody>
        </Card>
      </div>

      {/* Operations History Table */}
      <Split hasGutter style={{ marginBottom: 8, alignItems: 'center' }}>
        <SplitItem>
          <Title headingLevel="h3">Operations History</Title>
        </SplitItem>
        <SplitItem isFilled />
        {history.length > 0 && (
          <SplitItem>
            <SearchInput
              placeholder="Search history..."
              value={historySearch}
              onChange={(_e, val) => setHistorySearch(val)}
              onClear={() => setHistorySearch('')}
              style={{ width: 220 }}
            />
          </SplitItem>
        )}
      </Split>
      {history.length > 0 ? (
        <div className="table-sticky-wrapper">
        <Table aria-label="Operations history" variant="compact" isStickyHeader>
          <Thead>
            <Tr>
              <Th>Time (UTC)</Th>
              <Th>Operation</Th>
              <Th>Target CI</Th>
              <Th>Values</Th>
              <Th>Status</Th>
              <Th>Message</Th>
            </Tr>
          </Thead>
          <Tbody>
            {filteredHistory.map((rec, i) => (
              <Tr key={`${rec.timestamp}-${rec.operation}-${i}`}>
                <Td dataLabel="Time (UTC)" className="date-cell">{rec.timestamp}</Td>
                <Td dataLabel="Operation">{rec.operation}</Td>
                <Td dataLabel="Target CI">{rec.target}</Td>
                <Td dataLabel="Values">{rec.values}</Td>
                <Td dataLabel="Status">
                  <span className={rec.status === 'success' ? 'status-verified' : 'status-failed'}>
                    {(() => { const Icon = statusIcon(rec.status); return Icon ? <Icon style={{ marginRight: 4 }} /> : null; })()}{rec.status}
                  </span>
                </Td>
                <Td dataLabel="Message">{rec.message}</Td>
              </Tr>
            ))}
          </Tbody>
        </Table>
        </div>
      ) : (
        <EmptyState titleText="No operations yet" headingLevel="h4">
          <EmptyStateBody>Run a lock, extend, disable auto-stop, scale, or Showroom operation above to see history here.</EmptyStateBody>
        </EmptyState>
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
            This will set the <code>demo.redhat.com/lock-enabled</code> label to <strong>true</strong> on{' '}
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
            This will set the <code>demo.redhat.com/lock-enabled</code> label to <strong>false</strong> on{' '}
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

      {/* Extend stop confirmation modal */}
      <Modal
        variant="small"
        isOpen={showExtStopConfirm}
        onClose={() => setShowExtStopConfirm(false)}
        aria-labelledby="ext-stop-confirm-title"
      >
        <ModalHeader title="Confirm Extend Stop Time" labelId="ext-stop-confirm-title" />
        <ModalBody>
          <p>
            Extend auto-stop time by <strong>{extStopDays}d {extStopHours}h</strong>
            {extStopFilter ? <> for <strong>"{extStopFilter}"</strong></> : <> for <strong>all catalog items</strong></>}.
          </p>
          {stopPreview && <p className="ops-preview" style={{ marginTop: 8 }}>{stopPreview}</p>}
        </ModalBody>
        <ModalFooter>
          <Button variant="primary" onClick={handleExtendStop}>Extend Stop</Button>
          <Button variant="link" onClick={() => setShowExtStopConfirm(false)}>Cancel</Button>
        </ModalFooter>
      </Modal>

      {/* Extend destroy confirmation modal */}
      <Modal
        variant="small"
        isOpen={showExtDestroyConfirm}
        onClose={() => setShowExtDestroyConfirm(false)}
        aria-labelledby="ext-destroy-confirm-title"
      >
        <ModalHeader title="Confirm Extend Destroy Time" labelId="ext-destroy-confirm-title" />
        <ModalBody>
          <p>
            Extend auto-destroy time by <strong>{extDestroyDays}d {extDestroyHours}h</strong>
            {extDestroyFilter ? <> for <strong>"{extDestroyFilter}"</strong></> : <> for <strong>all catalog items</strong></>}.
          </p>
          {destroyPreview && <p className="ops-preview" style={{ marginTop: 8 }}>{destroyPreview}</p>}
        </ModalBody>
        <ModalFooter>
          <Button variant="primary" onClick={handleExtendDestroy}>Extend Destroy</Button>
          <Button variant="link" onClick={() => setShowExtDestroyConfirm(false)}>Cancel</Button>
        </ModalFooter>
      </Modal>

      {/* Disable auto-stop confirmation modal */}
      <Modal
        variant="small"
        isOpen={showNoAutostopConfirm}
        onClose={() => setShowNoAutostopConfirm(false)}
        aria-labelledby="no-autostop-confirm-title"
      >
        <ModalHeader title="Confirm Disable Auto-Stop" labelId="no-autostop-confirm-title" titleIconVariant="warning" />
        <ModalBody>
          <p>This will remove the auto-stop schedule from workshops{noAutostopFilter ? <> matching <strong>&quot;{noAutostopFilter}&quot;</strong></> : <> (<strong>all catalog items</strong>)</>}.</p>
          <p style={{ marginTop: 8 }}>Workshops will remain running until their scheduled destroy time or until manually stopped.</p>
        </ModalBody>
        <ModalFooter>
          <Button variant="warning" onClick={handleDisableAutostop}>Disable Auto-Stop</Button>
          <Button variant="link" onClick={() => setShowNoAutostopConfirm(false)}>Cancel</Button>
        </ModalFooter>
      </Modal>

      {/* Showroom cleanup confirmation modal */}
      <Modal
        variant="small"
        isOpen={showShowroomCleanupConfirm}
        onClose={() => setShowShowroomCleanupConfirm(false)}
        aria-labelledby="showroom-cleanup-confirm-title"
      >
        <ModalHeader title="Confirm Showroom Cleanup" labelId="showroom-cleanup-confirm-title" titleIconVariant="danger" />
        <ModalBody>
          <p>This will remove all Showroom resources (pods, services, routes, ConfigMaps){showroomFilter ? <> for <strong>&quot;{showroomFilter}&quot;</strong></> : <> in <strong>all namespaces</strong></>}.</p>
          <p style={{ marginTop: 8 }}>Students will lose access to their lab environments. This cannot be undone.</p>
        </ModalBody>
        <ModalFooter>
          <Button variant="danger" onClick={handleShowroomCleanup}>Cleanup</Button>
          <Button variant="link" onClick={() => setShowShowroomCleanupConfirm(false)}>Cancel</Button>
        </ModalFooter>
      </Modal>
    </PageSection>
  );
};
