import { useState, useEffect, useCallback, useMemo, useRef, type CSSProperties } from 'react';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardTitle,
  EmptyState,
  EmptyStateBody,
  Form,
  FormGroup,
  FormHelperText,
  FormSelect,
  FormSelectOption,
  HelperText,
  HelperTextItem,
  Label,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  PageSection,
  Split,
  SplitItem,
  Spinner,
  Switch,
  TextInput,
  Title,
  SearchInput,
  Tooltip,
} from '@patternfly/react-core';
import EyeIcon from '@patternfly/react-icons/dist/esm/icons/eye-icon';
import EyeSlashIcon from '@patternfly/react-icons/dist/esm/icons/eye-slash-icon';
import PlusCircleIcon from '@patternfly/react-icons/dist/esm/icons/plus-circle-icon';
import CopyIcon from '@patternfly/react-icons/dist/esm/icons/copy-icon';
import TrashIcon from '@patternfly/react-icons/dist/esm/icons/trash-icon';
import DownloadIcon from '@patternfly/react-icons/dist/esm/icons/download-icon';
import UndoIcon from '@patternfly/react-icons/dist/esm/icons/undo-icon';
import SaveIcon from '@patternfly/react-icons/dist/esm/icons/save-icon';
import CheckCircleIcon from '@patternfly/react-icons/dist/esm/icons/check-circle-icon';
import ArrowUpIcon from '@patternfly/react-icons/dist/esm/icons/arrow-up-icon';
import ArrowDownIcon from '@patternfly/react-icons/dist/esm/icons/arrow-down-icon';
import KeyIcon from '@patternfly/react-icons/dist/esm/icons/key-icon';

import { api, clearApiCache } from '../services/api';
import type { WorkshopSchedule, CatalogItemEntry, CatalogItemParameter } from '../types';
import { createBlankWorkshopSchedule } from '../utils/scheduleDefaults';
import { workshopSchedulesToCsv, downloadTextFile } from '../utils/scheduleCsv';
import { CatalogItemSelect } from './CatalogItemSelect';

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function parseOptInt(s: string): number | null {
  const t = s.trim();
  if (t === '') return null;
  const n = parseInt(t, 10);
  return Number.isNaN(n) ? null : n;
}

const DATE_RE = /^\d{1,2}\/\d{1,2}\/\d{2,4}\s+\d{1,2}:\d{2}$/;
function isValidDateStr(v: string): boolean {
  return v.trim() === '' || DATE_RE.test(v.trim());
}

function parseDateStr(v: string): Date | null {
  const m = v.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})\s+(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const yr = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  return new Date(Date.UTC(yr, Number(m[2]) - 1, Number(m[1]), Number(m[4]), Number(m[5])));
}

function fmtDateUTC(d: Date): string {
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const yyyy = d.getUTCFullYear();
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mi = String(d.getUTCMinutes()).padStart(2, '0');
  return `${dd}/${mm}/${yyyy} ${hh}:${mi}`;
}

function generatePassword(len = 12): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  const arr = new Uint8Array(len);
  crypto.getRandomValues(arr);
  return Array.from(arr, (b) => chars[b % chars.length]).join('');
}

function findParam(params: CatalogItemParameter[], name: string): CatalogItemParameter | undefined {
  return params.find((p) => p.name === name);
}

function paramSummary(p: CatalogItemParameter): string {
  const parts: string[] = [p.name];
  if (p.default != null) parts.push(`default: ${p.default}`);
  if (p.minimum != null && p.maximum != null) parts.push(`${p.minimum}–${p.maximum}`);
  else if (p.maximum != null) parts.push(`max: ${p.maximum}`);
  if (p.enum) parts.push(`options: ${p.enum.join(', ')}`);
  return parts.join(' · ');
}

function rowIsValid(r: WorkshopSchedule): boolean {
  if (!r.ci.trim() || !r.namespace.trim() || !r.password.trim() || !r.provisioning_date.trim() || !r.auto_destroy.trim()) return false;
  const prov = parseDateStr(r.provisioning_date);
  const dest = parseDateStr(r.auto_destroy);
  if (prov && dest && dest <= prov) return false;
  return true;
}

type Props = {
  showToast: (msg: string, variant?: 'success' | 'danger' | 'info') => void;
};

const formGrid: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 340px), 1fr))',
  gap: 'var(--pf-v6-global--spacer--md)',
  alignItems: 'start',
};

const sectionTitle: CSSProperties = {
  gridColumn: '1 / -1',
  fontWeight: 600,
  fontSize: '0.95rem',
  borderBottom: '1px solid var(--pf-v6-global--BorderColor--100)',
  paddingBottom: 4,
  marginTop: 8,
};

const catalogListStyle: CSSProperties = {
  maxHeight: 300,
  overflowY: 'auto',
  border: '1px solid var(--pf-v6-global--BorderColor--100)',
  borderRadius: 6,
  marginTop: 8,
  padding: 0,
};

const catalogItemStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'baseline',
  gap: 8,
  padding: '6px 12px',
  borderBottom: '1px solid var(--pf-v6-global--BorderColor--100)',
  cursor: 'pointer',
  transition: 'background 0.1s',
};

const CATALOG_PAGE_SIZE = 200;

export function ScheduleEditPage({ showToast }: Props) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [drafts, setDrafts] = useState<WorkshopSchedule[]>([]);
  const [serverSnapshot, setServerSnapshot] = useState<string>('');
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [showPassword, setShowPassword] = useState(false);
  const [catalogItems, setCatalogItems] = useState<CatalogItemEntry[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogSearch, setCatalogSearch] = useState('');
  const [catalogPage, setCatalogPage] = useState(0);
  const [confirmRemoveOpen, setConfirmRemoveOpen] = useState(false);
  const fieldsRef = useRef<HTMLDivElement>(null);
  const catalogLoadedOnce = useRef(false);

  const isDirty = useMemo(
    () => JSON.stringify(drafts) !== serverSnapshot,
    [drafts, serverSnapshot],
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      clearApiCache();
      const rows = await api.getSchedules();
      const cloned = rows.map((r) => ({ ...r }));
      setDrafts(cloned);
      setServerSnapshot(JSON.stringify(cloned));
      setSelectedIdx(0);
    } catch (e) {
      showToast(`Failed to load schedules: ${errMsg(e)}`, 'danger');
      setDrafts([]);
      setServerSnapshot('[]');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (catalogLoadedOnce.current || drafts.length === 0 || loading) return;
    catalogLoadedOnce.current = true;
    (async () => {
      setCatalogLoading(true);
      try {
        const items = await api.listCatalogItems();
        setCatalogItems(items);
      } catch {
        // Silent — user can click "Load catalog" manually
      } finally {
        setCatalogLoading(false);
      }
    })();
  }, [drafts.length, loading]);

  // Keyboard nav: Alt+Up/Down for prev/next row, Ctrl+S to save
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) {
        if (e.key === 's' && (e.ctrlKey || e.metaKey)) {
          e.preventDefault();
          if (isDirty && !saving && handleSaveRef.current) handleSaveRef.current();
          return;
        }
        if (!e.altKey) return;
      }
      if (e.altKey && e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIdx((i) => Math.max(0, i - 1));
      } else if (e.altKey && e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIdx((i) => Math.min(drafts.length - 1, i + 1));
      } else if (e.key === 's' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        if (isDirty && !saving && handleSaveRef.current) handleSaveRef.current();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [drafts.length, isDirty, saving]);

  const patch = useCallback((i: number, partial: Partial<WorkshopSchedule>) => {
    setDrafts((prev) => prev.map((row, j) => (j === i ? { ...row, ...partial } : row)));
  }, []);

  const globalRowErrors = useMemo(() => {
    const issues: string[] = [];
    drafts.forEach((r, i) => {
      if (!r.ci.trim()) issues.push(`Row ${i + 1}: CI missing`);
      if (!r.namespace.trim()) issues.push(`Row ${i + 1}: Namespace missing`);
    });
    return issues;
  }, [drafts]);

  // Use ref to ensure keyboard shortcut always calls the latest handleSave
  const handleSaveRef = useRef<() => Promise<void>>();

  const handleSave = useCallback(async () => {
    if (globalRowErrors.length > 0) {
      showToast(`Cannot save: ${globalRowErrors[0]}${globalRowErrors.length > 1 ? ` (+${globalRowErrors.length - 1} more)` : ''}`, 'danger');
      return;
    }
    setSaving(true);
    try {
      await api.updateSchedules(drafts);
      clearApiCache();
      setServerSnapshot(JSON.stringify(drafts));
      showToast(`Saved ${drafts.length} schedule(s) to the server`, 'success');
    } catch (e) {
      showToast(`Save failed: ${errMsg(e)}`, 'danger');
    } finally {
      setSaving(false);
    }
  }, [drafts, globalRowErrors, showToast, clearApiCache]);

  // Update ref whenever handleSave changes
  useEffect(() => {
    handleSaveRef.current = handleSave;
  }, [handleSave]);

  const handleRevert = async () => {
    await load();
    showToast('Reloaded schedules from server', 'info');
  };

  const addRow = () => {
    const blank = createBlankWorkshopSchedule();
    setDrafts((prev) => [...prev, blank]);
    setSelectedIdx(drafts.length);
    setTimeout(() => fieldsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80);
  };

  const duplicateRow = () => {
    const row = drafts[selectedIdx];
    if (!row) return;
    const base = row.ci_name || row.ci || 'Row';
    const copy = { ...row, ci_name: `${base} (copy)` };
    const next = [...drafts.slice(0, selectedIdx + 1), copy, ...drafts.slice(selectedIdx + 1)];
    setDrafts(next);
    setSelectedIdx(selectedIdx + 1);
  };

  const moveRow = (dir: -1 | 1) => {
    const target = selectedIdx + dir;
    if (target < 0 || target >= drafts.length) return;
    const next = [...drafts];
    [next[selectedIdx], next[target]] = [next[target], next[selectedIdx]];
    setDrafts(next);
    setSelectedIdx(target);
  };

  const removeRow = () => {
    if (drafts.length <= 1) {
      setDrafts([]);
      setSelectedIdx(0);
    } else {
      const next = drafts.filter((_, j) => j !== selectedIdx);
      setDrafts(next);
      setSelectedIdx(Math.min(selectedIdx, next.length - 1));
    }
    setConfirmRemoveOpen(false);
  };

  const setQuickDates = (hoursFromNow: number, lifespanHours: number) => {
    const now = new Date();
    const provision = new Date(now.getTime() + hoursFromNow * 3600_000);
    const destroy = new Date(provision.getTime() + lifespanHours * 3600_000);
    const stop = lifespanHours > 12 ? new Date(destroy.getTime() - 2 * 3600_000) : undefined;
    patch(selectedIdx, {
      provisioning_date: fmtDateUTC(provision),
      auto_destroy: fmtDateUTC(destroy),
      auto_stop: stop ? fmtDateUTC(stop) : '',
    });
  };

  const applyCatalogItem = (item: CatalogItemEntry) => {
    const updates: Partial<WorkshopSchedule> = {
      ci: item.id,
      ci_name: item.display_name || item.id,
    };

    const numUsers = findParam(item.parameters, 'num_users');
    if (numUsers?.default != null) {
      updates.users = Number(numUsers.default) || null;
    }

    const awsRegion = findParam(item.parameters, 'aws_region');
    if (awsRegion?.default != null && typeof awsRegion.default === 'string') {
      updates.aws_regions = awsRegion.default;
    }

    patch(selectedIdx, updates);
    const filled = Object.keys(updates).filter((k) => k !== 'ci' && k !== 'ci_name');
    const extra = filled.length ? ` (also set ${filled.join(', ')})` : '';
    showToast(`Applied "${item.display_name}" to row ${selectedIdx + 1}${extra}`, 'success');
  };

  const fetchCatalog = async () => {
    setCatalogLoading(true);
    try {
      const items = await api.listCatalogItems();
      setCatalogItems(items);
      setCatalogPage(0);
      showToast(`Loaded ${items.length} catalog item(s) from cluster`, 'success');
    } catch (e) {
      setCatalogItems([]);
      showToast(`Catalog fetch failed: ${errMsg(e)}`, 'danger');
    } finally {
      setCatalogLoading(false);
    }
  };

  const filteredCatalog = useMemo(() => {
    const q = catalogSearch.trim().toLowerCase();
    if (!q) return catalogItems;
    return catalogItems.filter(
      (it) =>
        it.id.toLowerCase().includes(q) ||
        it.display_name.toLowerCase().includes(q) ||
        it.category.toLowerCase().includes(q) ||
        it.description.toLowerCase().includes(q),
    );
  }, [catalogItems, catalogSearch]);

  const catalogTotalPages = Math.max(1, Math.ceil(filteredCatalog.length / CATALOG_PAGE_SIZE));
  const catalogSlice = filteredCatalog.slice(
    catalogPage * CATALOG_PAGE_SIZE,
    (catalogPage + 1) * CATALOG_PAGE_SIZE,
  );

  useEffect(() => {
    setCatalogPage(0);
  }, [catalogSearch]);

  const handleDownloadCsv = () => {
    if (drafts.length === 0) {
      showToast('No rows to download', 'danger');
      return;
    }
    const text = workshopSchedulesToCsv(drafts);
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    downloadTextFile(`schedules-${stamp}.csv`, text);
    showToast('CSV downloaded', 'success');
  };

  const startBlank = () => {
    setDrafts([createBlankWorkshopSchedule()]);
    setServerSnapshot('[]');
    setSelectedIdx(0);
    setLoading(false);
  };

  const loadExample = async (slug: string) => {
    try {
      const resp = await api.loadScheduleExample(slug);
      const cloned = resp.schedules.map((r) => ({ ...r }));
      setDrafts(cloned);
      setServerSnapshot('[]');
      setSelectedIdx(0);
      setLoading(false);
      showToast(`Loaded "${slug}" example (${cloned.length} row${cloned.length !== 1 ? 's' : ''})`, 'success');
    } catch (e) {
      showToast(`Failed to load example: ${errMsg(e)}`, 'danger');
    }
  };

  const goBack = () => {
    window.location.hash = 'upload';
  };

  const s = drafts[selectedIdx];

  if (loading) {
    return (
      <PageSection>
        <Spinner aria-label="Loading schedules" />
      </PageSection>
    );
  }

  if (drafts.length === 0) {
    return (
      <PageSection>
        <Title headingLevel="h1" style={{ marginBottom: 16 }}>
          Schedule Builder
        </Title>
        <EmptyState titleText="No schedules loaded" headingLevel="h2" icon={PlusCircleIcon}>
          <EmptyStateBody>
            Start a blank schedule, load a built-in example, or go back to the Upload tab to import a CSV first.
          </EmptyStateBody>
          <Split hasGutter style={{ justifyContent: 'center', flexWrap: 'wrap' }}>
            <SplitItem>
              <Button variant="primary" onClick={startBlank}>Start blank schedule</Button>
            </SplitItem>
            <SplitItem>
              <Button variant="secondary" onClick={() => loadExample('basic')}>Load "basic" example</Button>
            </SplitItem>
            <SplitItem>
              <Button variant="secondary" onClick={() => loadExample('full')}>Load "full" example</Button>
            </SplitItem>
            <SplitItem>
              <Button variant="secondary" onClick={load}>Reload from server</Button>
            </SplitItem>
            <SplitItem>
              <Button variant="link" onClick={goBack}>Back to app</Button>
            </SplitItem>
          </Split>
        </EmptyState>
      </PageSection>
    );
  }

  const rowErrors: string[] = [];
  if (s) {
    if (!s.ci.trim()) rowErrors.push('CI is required');
    if (!s.namespace.trim()) rowErrors.push('Namespace is required');
    if (!s.password.trim()) rowErrors.push('Password is required');
    if (!s.provisioning_date.trim()) rowErrors.push('Provisioning date is required');
    else if (!isValidDateStr(s.provisioning_date)) rowErrors.push('Provisioning date format: DD/MM/YYYY HH:MM');
    if (!s.auto_destroy.trim()) rowErrors.push('Auto-destroy date is required');
    else if (!isValidDateStr(s.auto_destroy)) rowErrors.push('Auto-destroy date format: DD/MM/YYYY HH:MM');
    if (s.auto_stop && !isValidDateStr(s.auto_stop)) rowErrors.push('Auto-stop date format: DD/MM/YYYY HH:MM');
  }

  const provDate = s ? parseDateStr(s.provisioning_date) : null;
  const destroyDate = s ? parseDateStr(s.auto_destroy) : null;
  const stopDate = s ? parseDateStr(s.auto_stop) : null;
  if (provDate && destroyDate && destroyDate <= provDate) rowErrors.push('Auto-destroy must be after the provisioning date');
  if (provDate && stopDate && stopDate <= provDate) rowErrors.push('Auto-stop must be after the provisioning date');
  if (stopDate && destroyDate && destroyDate < stopDate) rowErrors.push('Auto-destroy should not be before auto-stop');

  const dateValidated = (v: string, required: boolean, field?: 'stop' | 'destroy') => {
    if (!v.trim()) return required ? 'error' as const : 'default' as const;
    if (!isValidDateStr(v)) return 'warning' as const;
    if (field === 'destroy' && provDate && destroyDate && destroyDate <= provDate) return 'warning' as const;
    if (field === 'destroy' && stopDate && destroyDate && destroyDate < stopDate) return 'warning' as const;
    if (field === 'stop' && provDate && stopDate && stopDate <= provDate) return 'warning' as const;
    return 'default' as const;
  };

  const validCount = drafts.filter(rowIsValid).length;

  return (
    <PageSection>
      {/* Toolbar */}
      <Split hasGutter style={{ marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <SplitItem>
          <Title headingLevel="h1" size="xl">Schedule Builder</Title>
        </SplitItem>
        <SplitItem>
          {isDirty ? (
            <Label color="orange">Unsaved changes</Label>
          ) : (
            <Label color="green" icon={<CheckCircleIcon />}>Saved</Label>
          )}
        </SplitItem>
        <SplitItem>
          <Tooltip content={`${validCount} of ${drafts.length} rows have all required fields filled`}>
            <Label color={validCount === drafts.length ? 'green' : 'orange'}>
              {validCount}/{drafts.length} ready
            </Label>
          </Tooltip>
        </SplitItem>
        {globalRowErrors.length > 0 && (
          <SplitItem>
            <Tooltip content={globalRowErrors.join('\n')}>
              <Label color="red">{globalRowErrors.length} error{globalRowErrors.length !== 1 ? 's' : ''}</Label>
            </Tooltip>
          </SplitItem>
        )}
        <SplitItem isFilled />
        <SplitItem>
          <Button variant="link" onClick={goBack}>← Back to app</Button>
        </SplitItem>
        <SplitItem>
          <Tooltip content="Download current rows as a CSV you can re-upload later">
            <Button variant="secondary" icon={<DownloadIcon />} onClick={handleDownloadCsv} isDisabled={saving}>
              CSV
            </Button>
          </Tooltip>
        </SplitItem>
        <SplitItem>
          <Tooltip content="Discard local changes and reload from server">
            <Button variant="secondary" icon={<UndoIcon />} onClick={handleRevert} isDisabled={saving}>
              Revert
            </Button>
          </Tooltip>
        </SplitItem>
        <SplitItem>
          <Tooltip content="Ctrl+S to save">
            <Button variant="primary" icon={<SaveIcon />} onClick={handleSave} isLoading={saving} isDisabled={saving || !isDirty}>
              Save all
            </Button>
          </Tooltip>
        </SplitItem>
      </Split>

      <Alert variant="info" isInline isPlain title="Edits are local until you Save. Alt+↑↓ to switch rows. Ctrl+S to save." style={{ marginBottom: 12 }} />

      {/* Row summary strip */}
      {drafts.length > 1 && (
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 12 }}>
          {drafts.map((row, i) => {
            const ok = rowIsValid(row);
            const active = i === selectedIdx;
            return (
              <Tooltip key={i} content={`${i + 1}. ${row.ci_name || row.ci || '(new row)'}${ok ? '' : ' — incomplete'}`}>
                <button
                  onClick={() => setSelectedIdx(i)}
                  aria-label={`Row ${i + 1}`}
                  style={{
                    width: 28, height: 28, borderRadius: 4, border: active ? '2px solid var(--pf-v6-global--primary-color--100)' : '1px solid var(--pf-v6-global--BorderColor--100)',
                    background: ok ? 'var(--pf-v6-global--success-color--100)' : 'var(--pf-v6-global--warning-color--100)',
                    color: '#fff', fontWeight: 600, fontSize: '0.75rem', cursor: 'pointer',
                    opacity: active ? 1 : 0.7, transform: active ? 'scale(1.15)' : 'none', transition: 'all 0.15s',
                  }}
                >
                  {i + 1}
                </button>
              </Tooltip>
            );
          })}
        </div>
      )}

      {/* Row selector */}
      <Card isCompact style={{ marginBottom: 12 }}>
        <CardBody>
          <Split hasGutter style={{ flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <SplitItem>
              <FormGroup label="Active row" fieldId="schedule-picker" style={{ marginBottom: 0 }}>
                <FormSelect
                  id="schedule-picker"
                  value={String(selectedIdx)}
                  onChange={(_e, val) => setSelectedIdx(Number(val))}
                  aria-label="Select schedule row"
                  style={{ minWidth: 280 }}
                >
                  {drafts.map((row, i) => (
                    <FormSelectOption
                      key={i}
                      value={String(i)}
                      label={`${i + 1}. ${row.ci_name || row.ci || '(new row)'}${rowIsValid(row) ? '' : ' ⚠'}`}
                    />
                  ))}
                </FormSelect>
              </FormGroup>
            </SplitItem>
            <SplitItem>
              <Badge isRead>{drafts.length} row{drafts.length !== 1 ? 's' : ''}</Badge>
            </SplitItem>
            <SplitItem isFilled />
            <SplitItem>
              <Tooltip content="Move row up (Alt+↑)"><Button variant="plain" icon={<ArrowUpIcon />} onClick={() => moveRow(-1)} isDisabled={saving || selectedIdx === 0} aria-label="Move row up" /></Tooltip>
            </SplitItem>
            <SplitItem>
              <Tooltip content="Move row down (Alt+↓)"><Button variant="plain" icon={<ArrowDownIcon />} onClick={() => moveRow(1)} isDisabled={saving || selectedIdx >= drafts.length - 1} aria-label="Move row down" /></Tooltip>
            </SplitItem>
            <SplitItem>
              <Button variant="secondary" icon={<PlusCircleIcon />} onClick={addRow} isDisabled={saving}>Add</Button>
            </SplitItem>
            <SplitItem>
              <Button variant="secondary" icon={<CopyIcon />} onClick={duplicateRow} isDisabled={saving || !s}>Duplicate</Button>
            </SplitItem>
            <SplitItem>
              <Button variant="danger" icon={<TrashIcon />} onClick={() => setConfirmRemoveOpen(true)} isDisabled={saving || drafts.length === 0}>Remove</Button>
            </SplitItem>
          </Split>
        </CardBody>
      </Card>

      {/* Remove confirmation */}
      <Modal variant="small" isOpen={confirmRemoveOpen} onClose={() => setConfirmRemoveOpen(false)} aria-label="Confirm remove">
        <ModalHeader title="Remove row?" />
        <ModalBody>
          Remove row {selectedIdx + 1} ({s?.ci_name || s?.ci || 'unnamed'})? This is a local change — click Save to persist it.
        </ModalBody>
        <ModalFooter>
          <Button variant="danger" onClick={removeRow}>Remove</Button>
          <Button variant="link" onClick={() => setConfirmRemoveOpen(false)}>Cancel</Button>
        </ModalFooter>
      </Modal>

      {/* Catalog picker */}
      <Card isCompact style={{ marginBottom: 12 }}>
        <CardTitle>
          Catalog Item Picker
          {catalogItems.length > 0 && <Badge isRead style={{ marginLeft: 8 }}>{catalogItems.length} items</Badge>}
        </CardTitle>
        <CardBody>
          <Split hasGutter style={{ flexWrap: 'wrap', alignItems: 'center' }}>
            <SplitItem>
              <Button variant={catalogItems.length ? 'secondary' : 'primary'} onClick={fetchCatalog} isLoading={catalogLoading} isDisabled={catalogLoading}>
                {catalogItems.length ? 'Refresh catalog' : 'Load catalog from cluster'}
              </Button>
            </SplitItem>
            {catalogItems.length > 0 && (
              <SplitItem isFilled style={{ minWidth: 220 }}>
                <SearchInput
                  placeholder="Search by name, CI ID, category, or description…"
                  value={catalogSearch}
                  onChange={(_e, v) => setCatalogSearch(v)}
                  onClear={() => setCatalogSearch('')}
                  aria-label="Filter catalog items"
                />
              </SplitItem>
            )}
          </Split>

          {catalogItems.length > 0 && (
            <>
              <div style={catalogListStyle}>
                {catalogSlice.length === 0 ? (
                  <div style={{ padding: 16, color: 'var(--pf-v6-global--Color--200)' }}>No matches.</div>
                ) : (
                  catalogSlice.map((it) => {
                    const isActive = s && s.ci === it.id;
                    const keyParams = it.parameters.filter((p) =>
                      ['num_users', 'aws_region'].includes(p.name) || p.enum,
                    );
                    return (
                      <div
                        key={`${it.catalog_namespace}/${it.id}`}
                        role="button"
                        tabIndex={0}
                        style={{
                          ...catalogItemStyle,
                          flexWrap: 'wrap',
                          background: isActive ? 'var(--pf-v6-global--palette--blue-50)' : undefined,
                        }}
                        onMouseOver={(e) => { if (!isActive) (e.currentTarget.style.background = 'var(--pf-v6-global--BackgroundColor--200)'); }}
                        onMouseOut={(e) => { e.currentTarget.style.background = isActive ? 'var(--pf-v6-global--palette--blue-50)' : ''; }}
                        onClick={() => applyCatalogItem(it)}
                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); applyCatalogItem(it); } }}
                      >
                        <span style={{ fontWeight: 500, flex: 1, minWidth: 180 }}>{it.display_name}</span>
                        <span style={{ color: 'var(--pf-v6-global--Color--200)', fontSize: '0.82rem', flexShrink: 0 }}>{it.id}</span>
                        <Label isCompact color={it.catalog_namespace.includes('event') ? 'orange' : 'blue'}>
                          {it.catalog_namespace.includes('event') ? 'event' : 'prod'}
                        </Label>
                        {it.category && <Label isCompact color="grey">{it.category}</Label>}
                        {isActive && <CheckCircleIcon style={{ color: 'var(--pf-v6-global--success-color--100)' }} />}
                        {(it.description || keyParams.length > 0) && (
                          <div style={{ width: '100%', fontSize: '0.78rem', color: 'var(--pf-v6-global--Color--200)', marginTop: 2 }}>
                            {it.description && <span>{it.description.slice(0, 120)}{it.description.length > 120 ? '…' : ''} </span>}
                            {keyParams.length > 0 && (
                              <span style={{ fontStyle: 'italic' }}>
                                {keyParams.map((p) => paramSummary(p)).join(' | ')}
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
              {catalogTotalPages > 1 && (
                <Split hasGutter style={{ marginTop: 6, alignItems: 'center', justifyContent: 'center' }}>
                  <SplitItem><Button variant="plain" size="sm" isDisabled={catalogPage === 0} onClick={() => setCatalogPage((p) => p - 1)}>← Prev</Button></SplitItem>
                  <SplitItem><span style={{ fontSize: '0.85rem' }}>Page {catalogPage + 1} of {catalogTotalPages} ({filteredCatalog.length} matches)</span></SplitItem>
                  <SplitItem><Button variant="plain" size="sm" isDisabled={catalogPage >= catalogTotalPages - 1} onClick={() => setCatalogPage((p) => p + 1)}>Next →</Button></SplitItem>
                </Split>
              )}
            </>
          )}
        </CardBody>
      </Card>

      {/* Row fields */}
      {s && (
        <Card isCompact ref={fieldsRef}>
          <CardTitle>
            <Split hasGutter style={{ alignItems: 'center' }}>
              <SplitItem>Row {selectedIdx + 1} of {drafts.length}</SplitItem>
              <SplitItem isFilled />
              {rowErrors.length > 0 && (
                <SplitItem><Label color="orange">{rowErrors.length} issue{rowErrors.length !== 1 ? 's' : ''}</Label></SplitItem>
              )}
              <SplitItem>
                <Switch id="show-password-global" label="Show passwords" isChecked={showPassword} onChange={(_e, c) => setShowPassword(c)} isReversed />
              </SplitItem>
            </Split>
          </CardTitle>
          <CardBody>
            {rowErrors.length > 0 && (
              <Alert variant="warning" isInline isPlain title={rowErrors.join(' · ')} style={{ marginBottom: 12 }} />
            )}
            <Form>
              {/* Identity */}
              <div style={formGrid}>
                <div style={sectionTitle}>Identity</div>
                <FormGroup label="CI Name" fieldId="ci_name" isRequired>
                  <TextInput id="ci_name" value={s.ci_name} onChange={(_e, v) => patch(selectedIdx, { ci_name: v })} placeholder="Display name for this workshop" />
                  <FormHelperText><HelperText><HelperTextItem variant="indeterminate">Pick from the catalog above or type manually</HelperTextItem></HelperText></FormHelperText>
                </FormGroup>
                <CatalogItemSelect
                  value={s.ci}
                  onChange={(v) => patch(selectedIdx, { ci: v })}
                  label="CI (Catalog Item ID)"
                  isRequired
                  helperText="Select from Babylon catalog or type to search"
                  filterNamespace={s.catalog_namespace}
                />
                <FormGroup label="Namespace" fieldId="namespace" isRequired>
                  <TextInput id="namespace" value={s.namespace} onChange={(_e, v) => patch(selectedIdx, { namespace: v })} validated={!s.namespace.trim() ? 'error' : 'default'} placeholder="user-you-redhat-com" />
                </FormGroup>
                <FormGroup label="Workshop Name" fieldId="workshop_name">
                  <TextInput id="workshop_name" value={s.workshop_name} onChange={(_e, v) => patch(selectedIdx, { workshop_name: v })} placeholder="Falls back to CI Name if empty" />
                </FormGroup>
                <FormGroup label="Password" fieldId="password" isRequired>
                  <Split hasGutter>
                    <SplitItem isFilled>
                      <TextInput
                        id="password"
                        type={showPassword ? 'text' : 'password'}
                        value={s.password}
                        onChange={(_e, v) => patch(selectedIdx, { password: v })}
                        validated={!s.password.trim() ? 'error' : 'default'}
                        autoComplete="off"
                        placeholder="Workshop access password"
                      />
                    </SplitItem>
                    <SplitItem>
                      <Button variant="control" aria-label={showPassword ? 'Mask password' : 'Reveal password'} onClick={() => setShowPassword((p) => !p)}>
                        {showPassword ? <EyeSlashIcon /> : <EyeIcon />}
                      </Button>
                    </SplitItem>
                    <SplitItem>
                      <Tooltip content="Generate random 12-character password">
                        <Button variant="control" aria-label="Generate password" icon={<KeyIcon />} onClick={() => { patch(selectedIdx, { password: generatePassword() }); setShowPassword(true); }} />
                      </Tooltip>
                    </SplitItem>
                  </Split>
                </FormGroup>
              </div>

              {/* Scheduling */}
              <div style={formGrid}>
                <div style={sectionTitle}>Schedule (UTC)</div>
                <FormGroup label="Provisioning Date" fieldId="provisioning_date" isRequired>
                  <TextInput
                    id="provisioning_date"
                    value={s.provisioning_date}
                    onChange={(_e, v) => patch(selectedIdx, { provisioning_date: v })}
                    validated={dateValidated(s.provisioning_date, true)}
                    placeholder="DD/MM/YYYY HH:MM"
                  />
                  <FormHelperText><HelperText><HelperTextItem variant="indeterminate">Example: 25/03/2026 14:00</HelperTextItem></HelperText></FormHelperText>
                </FormGroup>
                <FormGroup label="Auto-stop" fieldId="auto_stop">
                  <TextInput
                    id="auto_stop"
                    value={s.auto_stop}
                    onChange={(_e, v) => patch(selectedIdx, { auto_stop: v })}
                    validated={dateValidated(s.auto_stop, false, 'stop')}
                    placeholder="DD/MM/YYYY HH:MM (optional)"
                  />
                </FormGroup>
                <FormGroup label="Auto-destroy" fieldId="auto_destroy" isRequired>
                  <TextInput
                    id="auto_destroy"
                    value={s.auto_destroy}
                    onChange={(_e, v) => patch(selectedIdx, { auto_destroy: v })}
                    validated={dateValidated(s.auto_destroy, true, 'destroy')}
                    placeholder="DD/MM/YYYY HH:MM"
                  />
                </FormGroup>
                <FormGroup label="Quick dates" fieldId="quick-dates">
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    <Tooltip content="Provision now, destroy in 4 hours"><Button variant="tertiary" size="sm" onClick={() => setQuickDates(0, 4)}>Now + 4h</Button></Tooltip>
                    <Tooltip content="Provision now, destroy in 8 hours"><Button variant="tertiary" size="sm" onClick={() => setQuickDates(0, 8)}>Now + 8h</Button></Tooltip>
                    <Tooltip content="Provision in 1 hour, destroy 24h later"><Button variant="tertiary" size="sm" onClick={() => setQuickDates(1, 24)}>+1h, 1 day</Button></Tooltip>
                    <Tooltip content="Provision in 1 hour, destroy 3 days later"><Button variant="tertiary" size="sm" onClick={() => setQuickDates(1, 72)}>+1h, 3 days</Button></Tooltip>
                    <Tooltip content="Provision in 24 hours, destroy 7 days later"><Button variant="tertiary" size="sm" onClick={() => setQuickDates(24, 168)}>Tomorrow, 1 week</Button></Tooltip>
                  </div>
                </FormGroup>
              </div>

              {/* Capacity */}
              <div style={formGrid}>
                <div style={sectionTitle}>Capacity & Purpose</div>
                <FormGroup label="Users (num_users)" fieldId="users">
                  <TextInput id="users" type="number" value={s.users == null ? '' : String(s.users)} onChange={(_e, v) => patch(selectedIdx, { users: parseOptInt(v) })} placeholder="Empty = catalog default" />
                  <FormHelperText><HelperText><HelperTextItem variant="indeterminate">Concurrent users the lab supports (passed as num_users to the catalog item)</HelperTextItem></HelperText></FormHelperText>
                </FormGroup>
                <FormGroup label="Instances (seat count)" fieldId="instances">
                  <TextInput id="instances" type="number" value={s.instances == null ? '' : String(s.instances)} onChange={(_e, v) => patch(selectedIdx, { instances: parseOptInt(v) })} placeholder="Empty = uses Users value" />
                  <FormHelperText><HelperText><HelperTextItem variant="indeterminate">Replica count for WorkshopProvision (spec.count) / MultiWorkshop (numberSeats)</HelperTextItem></HelperText></FormHelperText>
                </FormGroup>
                <FormGroup label="Count (repeat deploy)" fieldId="count">
                  <TextInput id="count" type="number" value={s.count == null ? '' : String(s.count)} onChange={(_e, v) => patch(selectedIdx, { count: parseOptInt(v) })} placeholder="Empty = 1 deployment" />
                  <FormHelperText><HelperText><HelperTextItem variant="indeterminate">Creates N independent deployments of this row</HelperTextItem></HelperText></FormHelperText>
                </FormGroup>
                <FormGroup label="Concurrency" fieldId="concurrency">
                  <TextInput id="concurrency" type="number" value={s.concurrency == null ? '' : String(s.concurrency)} onChange={(_e, v) => patch(selectedIdx, { concurrency: parseOptInt(v) })} placeholder="Default: 1" />
                  <FormHelperText><HelperText><HelperTextItem variant="indeterminate">How many provisions can run in parallel</HelperTextItem></HelperText></FormHelperText>
                </FormGroup>
                <FormGroup label="Activity" fieldId="activity">
                  <TextInput id="activity" value={s.activity} onChange={(_e, v) => patch(selectedIdx, { activity: v })} placeholder="Admin" />
                </FormGroup>
                <FormGroup label="Purpose" fieldId="purpose">
                  <TextInput id="purpose" value={s.purpose} onChange={(_e, v) => patch(selectedIdx, { purpose: v })} placeholder="QA" />
                </FormGroup>
              </div>

              {/* Toggles */}
              <div style={formGrid}>
                <div style={sectionTitle}>Options</div>
                <FormGroup label="Workshop UI" fieldId="enable_workshop_interface">
                  <Switch id="enable_workshop_interface" label="Workshop interface" isChecked={s.enable_workshop_interface} onChange={(_e, c) => patch(selectedIdx, { enable_workshop_interface: c })} />
                </FormGroup>
                <FormGroup label="Redirect" fieldId="redirect">
                  <Switch id="redirect" label="Lab redirect" isChecked={s.redirect} onChange={(_e, c) => patch(selectedIdx, { redirect: c })} />
                </FormGroup>
                <FormGroup label="White Glove" fieldId="white_glove">
                  <Switch id="white_glove" label="White glove mode" isChecked={s.white_glove} onChange={(_e, c) => patch(selectedIdx, { white_glove: c })} />
                </FormGroup>
              </div>

              {/* Multi-asset */}
              <div style={formGrid}>
                <div style={sectionTitle}>Multi-Asset</div>
                <FormGroup label="Multi-asset" fieldId="is_multi_asset">
                  <Switch id="is_multi_asset" label="Multi-asset workshop" isChecked={s.is_multi_asset} onChange={(_e, c) => patch(selectedIdx, { is_multi_asset: c })} />
                </FormGroup>
                <FormGroup label="Asset CIs" fieldId="asset_cis">
                  <TextInput id="asset_cis" value={s.asset_cis} onChange={(_e, v) => patch(selectedIdx, { asset_cis: v })} placeholder="ci1,ci2,ci3" />
                </FormGroup>
                <FormGroup label="Multi Workshop Name" fieldId="multi_workshop_name">
                  <TextInput id="multi_workshop_name" value={s.multi_workshop_name} onChange={(_e, v) => patch(selectedIdx, { multi_workshop_name: v })} placeholder="Shared name for grouped assets" />
                </FormGroup>
              </div>

              {/* Salesforce & regions */}
              <div style={formGrid}>
                <div style={sectionTitle}>Salesforce & Regions</div>
                <FormGroup label="Salesforce IDs" fieldId="salesforce_ids">
                  <TextInput id="salesforce_ids" value={s.salesforce_ids} onChange={(_e, v) => patch(selectedIdx, { salesforce_ids: v })} placeholder="type:id;type:id or plain IDs" />
                </FormGroup>
                <FormGroup label="Salesforce Type" fieldId="salesforce_type">
                  <FormSelect id="salesforce_type" value={s.salesforce_type} onChange={(_e, v) => patch(selectedIdx, { salesforce_type: v })}>
                    <FormSelectOption value="opportunity" label="opportunity" />
                    <FormSelectOption value="campaign" label="campaign" />
                    <FormSelectOption value="project" label="project" />
                    <FormSelectOption value="cdh" label="cdh" />
                  </FormSelect>
                </FormGroup>
                <FormGroup label="AWS Regions" fieldId="aws_regions">
                  <TextInput id="aws_regions" value={s.aws_regions} onChange={(_e, v) => patch(selectedIdx, { aws_regions: v })} placeholder="us-east-1,eu-west-1" />
                </FormGroup>
              </div>

              {/* Showroom */}
              <div style={formGrid}>
                <div style={sectionTitle}>Showroom</div>
                <FormGroup label="Repo URL" fieldId="showroom_repo">
                  <TextInput id="showroom_repo" value={s.showroom_repo} onChange={(_e, v) => patch(selectedIdx, { showroom_repo: v })} placeholder="https://github.com/rhpds/showroom-*.git" />
                </FormGroup>
                <FormGroup label="Ref (branch/tag)" fieldId="showroom_ref">
                  <TextInput id="showroom_ref" value={s.showroom_ref} onChange={(_e, v) => patch(selectedIdx, { showroom_ref: v })} placeholder="main (leave blank unless needed)" />
                </FormGroup>
                <FormGroup label="noVNC Desktop" fieldId="showroom_novnc">
                  <Switch id="showroom_novnc" label="noVNC desktop" isChecked={s.showroom_novnc} onChange={(_e, c) => patch(selectedIdx, { showroom_novnc: c })} />
                </FormGroup>
                <FormGroup label="Zerotouch" fieldId="showroom_zerotouch">
                  <Switch id="showroom_zerotouch" label="Zerotouch" isChecked={s.showroom_zerotouch} onChange={(_e, c) => patch(selectedIdx, { showroom_zerotouch: c })} />
                </FormGroup>
              </div>
            </Form>
          </CardBody>
        </Card>
      )}
    </PageSection>
  );
}
