import { useState, useEffect, useCallback, useMemo, type CSSProperties } from 'react';
import {
  Alert,
  Button,
  Card,
  CardBody,
  CardTitle,
  EmptyState,
  EmptyStateBody,
  Form,
  FormGroup,
  FormSelect,
  FormSelectOption,
  PageSection,
  Split,
  SplitItem,
  Spinner,
  Switch,
  TextInput,
  Title,
  SearchInput,
} from '@patternfly/react-core';
import EyeIcon from '@patternfly/react-icons/dist/esm/icons/eye-icon';
import EyeSlashIcon from '@patternfly/react-icons/dist/esm/icons/eye-slash-icon';

import { api, clearApiCache } from '../services/api';
import type { WorkshopSchedule, CatalogItemEntry } from '../types';
import { createBlankWorkshopSchedule } from '../utils/scheduleDefaults';
import { workshopSchedulesToCsv, downloadTextFile } from '../utils/scheduleCsv';

function parseOptInt(s: string): number | null {
  const t = s.trim();
  if (t === '') return null;
  const n = parseInt(t, 10);
  return Number.isNaN(n) ? null : n;
}

type Props = {
  showToast: (msg: string, variant?: 'success' | 'danger' | 'info') => void;
};

const formGrid: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 380px), 1fr))',
  gap: 'var(--pf-v6-global--spacer--md)',
  alignItems: 'start',
};

const catalogListStyle: CSSProperties = {
  maxHeight: 280,
  overflowY: 'auto',
  border: '1px solid var(--pf-v6-global--BorderColor--100)',
  borderRadius: 4,
  marginTop: 8,
};

export function ScheduleEditPage({ showToast }: Props) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [drafts, setDrafts] = useState<WorkshopSchedule[]>([]);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [showPassword, setShowPassword] = useState(false);
  const [catalogItems, setCatalogItems] = useState<CatalogItemEntry[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogSearch, setCatalogSearch] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      clearApiCache();
      const rows = await api.getSchedules();
      setDrafts(rows.map((r) => ({ ...r })));
      setSelectedIdx(0);
    } catch (e) {
      showToast(`Failed to load schedules: ${e}`, 'danger');
      setDrafts([]);
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    load();
  }, [load]);

  const patch = useCallback((i: number, partial: Partial<WorkshopSchedule>) => {
    setDrafts((prev) => prev.map((row, j) => (j === i ? { ...row, ...partial } : row)));
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.updateSchedules(drafts);
      clearApiCache();
      showToast(`Saved ${drafts.length} schedule row(s) on the server`, 'success');
    } catch (e) {
      showToast(`Save failed: ${e}`, 'danger');
    } finally {
      setSaving(false);
    }
  };

  const handleRevert = () => {
    load();
    showToast('Reloaded from server', 'info');
  };

  const addRow = () => {
    setDrafts((prev) => {
      const next = [...prev, createBlankWorkshopSchedule()];
      setSelectedIdx(next.length - 1);
      return next;
    });
    showToast('Added a new row — fill in CI & namespace, then Save all', 'info');
  };

  const duplicateRow = () => {
    setDrafts((prev) => {
      const row = prev[selectedIdx];
      if (!row) return prev;
      const copy = { ...row, ci_name: `${row.ci_name || row.ci || 'Row'} (copy)` };
      const next = [...prev.slice(0, selectedIdx + 1), copy, ...prev.slice(selectedIdx + 1)];
      setSelectedIdx(selectedIdx + 1);
      return next;
    });
  };

  const removeRow = () => {
    setDrafts((prev) => {
      if (prev.length === 0) return prev;
      const next = prev.filter((_, j) => j !== selectedIdx);
      setSelectedIdx((s) => Math.min(s, Math.max(0, next.length - 1)));
      return next;
    });
  };

  const applyCatalogItem = (item: CatalogItemEntry) => {
    patch(selectedIdx, {
      ci: item.id,
      ci_name: item.display_name || item.id,
    });
    showToast(`Set CI to ${item.id}`, 'success');
  };

  const fetchCatalog = async () => {
    setCatalogLoading(true);
    try {
      const items = await api.listCatalogItems();
      setCatalogItems(items);
      showToast(`Loaded ${items.length} catalog item(s)`, 'success');
    } catch (e) {
      setCatalogItems([]);
      showToast(`Catalog list failed: ${e}`, 'danger');
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
        it.display_name.toLowerCase().includes(q),
    );
  }, [catalogItems, catalogSearch]);

  const handleDownloadCsv = () => {
    if (drafts.length === 0) {
      showToast('Nothing to download', 'danger');
      return;
    }
    const text = workshopSchedulesToCsv(drafts);
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    downloadTextFile(`schedules-${stamp}.csv`, text);
    showToast('Downloaded CSV — you can re-upload it on the Upload tab', 'success');
  };

  const startBlank = () => {
    setDrafts([createBlankWorkshopSchedule()]);
    setSelectedIdx(0);
    setLoading(false);
    showToast('Blank row added — pick a catalog item or type CI manually', 'info');
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
          Schedule builder
        </Title>
        <EmptyState titleText="No schedules in this session" headingLevel="h2">
          <EmptyStateBody>
            Start from scratch here, or load CSVs from the Upload tab in the main window and open this page again.
          </EmptyStateBody>
          <Split hasGutter>
            <SplitItem>
              <Button variant="primary" onClick={startBlank}>
                Start blank schedule
              </Button>
            </SplitItem>
            <SplitItem>
              <Button variant="secondary" onClick={load}>
                Reload from server
              </Button>
            </SplitItem>
            <SplitItem>
              <Button variant="link" onClick={goBack}>
                Back to app
              </Button>
            </SplitItem>
          </Split>
        </EmptyState>
      </PageSection>
    );
  }

  return (
    <PageSection>
      <Split hasGutter style={{ marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <SplitItem>
          <Title headingLevel="h1">Schedule builder</Title>
        </SplitItem>
        <SplitItem isFilled />
        <SplitItem>
          <Button variant="link" onClick={goBack}>
            ← Back to app
          </Button>
        </SplitItem>
        <SplitItem>
          <Button variant="secondary" onClick={handleDownloadCsv} isDisabled={saving}>
            Download CSV
          </Button>
        </SplitItem>
        <SplitItem>
          <Button variant="secondary" onClick={handleRevert} isDisabled={saving}>
            Revert from server
          </Button>
        </SplitItem>
        <SplitItem>
          <Button variant="primary" onClick={handleSave} isLoading={saving} isDisabled={saving}>
            Save all to server
          </Button>
        </SplitItem>
      </Split>

      <Alert variant="info" isInline title="Tip" style={{ marginBottom: 16 }}>
        Edits stay in this page until you click <strong>Save all to server</strong>. Refresh the Upload tab (reload the page there) to see the same rows. Use{' '}
        <strong>Download CSV</strong> to back up or edit offline.
      </Alert>

      <Card isCompact style={{ marginBottom: 16 }}>
        <CardTitle>Rows</CardTitle>
        <CardBody>
          <Split hasGutter style={{ flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <SplitItem>
              <FormGroup label="Active row" fieldId="schedule-picker" style={{ marginBottom: 0 }}>
                <FormSelect
                  id="schedule-picker"
                  value={String(selectedIdx)}
                  onChange={(_e, val) => setSelectedIdx(Number(val))}
                  aria-label="Select schedule row"
                >
                  {drafts.map((row, i) => (
                    <FormSelectOption
                      key={i}
                      value={String(i)}
                      label={`${i + 1}. ${row.ci_name || row.ci || '(unnamed)'}`}
                    />
                  ))}
                </FormSelect>
              </FormGroup>
            </SplitItem>
            <SplitItem>
              <Button variant="secondary" onClick={addRow} isDisabled={saving}>
                Add row
              </Button>
            </SplitItem>
            <SplitItem>
              <Button variant="secondary" onClick={duplicateRow} isDisabled={saving || !s}>
                Duplicate row
              </Button>
            </SplitItem>
            <SplitItem>
              <Button variant="danger" onClick={removeRow} isDisabled={saving || drafts.length === 0}>
                Remove row
              </Button>
            </SplitItem>
          </Split>
        </CardBody>
      </Card>

      <Card isCompact style={{ marginBottom: 16 }}>
        <CardTitle>Pick from cluster catalog</CardTitle>
        <CardBody>
          <p style={{ marginTop: 0, fontSize: '0.875rem', color: 'var(--pf-v6-global--Color--200)' }}>
            Loads CatalogItems from <code>babylon-catalog-prod</code> and <code>babylon-catalog-event</code>. Applies to the <strong>active row</strong>; you can still edit CI name and ID by hand.
          </p>
          <Split hasGutter style={{ flexWrap: 'wrap', alignItems: 'center' }}>
            <SplitItem>
              <Button variant="primary" onClick={fetchCatalog} isLoading={catalogLoading}>
                {catalogItems.length ? 'Refresh catalog' : 'Load catalog from cluster'}
              </Button>
            </SplitItem>
            <SplitItem isFilled style={{ minWidth: 200 }}>
              <SearchInput
                placeholder="Filter by name or Catalog Item ID…"
                value={catalogSearch}
                onChange={(_e, v) => setCatalogSearch(v)}
                onClear={() => setCatalogSearch('')}
              />
            </SplitItem>
          </Split>
          {catalogItems.length > 0 && (
            <div style={catalogListStyle} className="pf-v6-u-p-sm">
              {filteredCatalog.length === 0 ? (
                <span style={{ color: 'var(--pf-v6-global--Color--200)' }}>No matches — clear the filter.</span>
              ) : (
                <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                  {filteredCatalog.slice(0, 500).map((it) => (
                    <li key={`${it.catalog_namespace}/${it.id}`} style={{ marginBottom: 6 }}>
                      <Button
                        variant="link"
                        isInline
                        onClick={() => applyCatalogItem(it)}
                        style={{ textAlign: 'left', padding: 0, height: 'auto', whiteSpace: 'normal' }}
                      >
                        <strong>{it.display_name}</strong>
                        <span style={{ color: 'var(--pf-v6-global--Color--200)', fontSize: '0.85rem' }}>
                          {' '}
                          — {it.id}
                        </span>
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
              {filteredCatalog.length > 500 && (
                <p style={{ fontSize: '0.8rem', marginBottom: 0 }}>
                  Showing first 500 matches — narrow the filter to find others.
                </p>
              )}
            </div>
          )}
        </CardBody>
      </Card>

      {s && (
        <Card isCompact>
          <CardTitle>Fields for row {selectedIdx + 1}</CardTitle>
          <CardBody>
            <div style={{ marginBottom: 16 }}>
              <Switch
                id="show-password-global"
                label="Show password in plain text"
                isChecked={showPassword}
                onChange={(_e, c) => setShowPassword(c)}
              />
            </div>
            <Form>
              <div style={formGrid}>
                <FormGroup label="CI name" fieldId="ci_name">
                  <TextInput id="ci_name" value={s.ci_name} onChange={(_e, v) => patch(selectedIdx, { ci_name: v })} />
                </FormGroup>
                <FormGroup label="CI (Catalog Item ID)" fieldId="ci">
                  <TextInput id="ci" value={s.ci} onChange={(_e, v) => patch(selectedIdx, { ci: v })} />
                </FormGroup>
                <FormGroup label="Namespace" fieldId="namespace">
                  <TextInput id="namespace" value={s.namespace} onChange={(_e, v) => patch(selectedIdx, { namespace: v })} />
                </FormGroup>
                <FormGroup label="Workshop name" fieldId="workshop_name">
                  <TextInput id="workshop_name" value={s.workshop_name} onChange={(_e, v) => patch(selectedIdx, { workshop_name: v })} />
                </FormGroup>
                <FormGroup label="Password" fieldId="password">
                  <Split hasGutter>
                    <SplitItem isFilled>
                      <TextInput
                        id="password"
                        type={showPassword ? 'text' : 'password'}
                        value={s.password}
                        onChange={(_e, v) => patch(selectedIdx, { password: v })}
                        autoComplete="off"
                      />
                    </SplitItem>
                    <SplitItem>
                      <Button
                        variant="control"
                        aria-label={showPassword ? 'Mask password' : 'Reveal password'}
                        onClick={() => setShowPassword((p) => !p)}
                      >
                        {showPassword ? <EyeSlashIcon /> : <EyeIcon />}
                      </Button>
                    </SplitItem>
                  </Split>
                </FormGroup>
                <FormGroup label="Users (empty = catalog default)" fieldId="users">
                  <TextInput
                    id="users"
                    value={s.users == null ? '' : String(s.users)}
                    onChange={(_e, v) => patch(selectedIdx, { users: parseOptInt(v) })}
                  />
                </FormGroup>
                <FormGroup label="Instances" fieldId="instances">
                  <TextInput
                    id="instances"
                    value={s.instances == null ? '' : String(s.instances)}
                    onChange={(_e, v) => patch(selectedIdx, { instances: parseOptInt(v) })}
                  />
                </FormGroup>
                <FormGroup label="Concurrency" fieldId="concurrency">
                  <TextInput
                    id="concurrency"
                    value={s.concurrency == null ? '' : String(s.concurrency)}
                    onChange={(_e, v) => patch(selectedIdx, { concurrency: parseOptInt(v) })}
                  />
                </FormGroup>
                <FormGroup label="Activity" fieldId="activity">
                  <TextInput id="activity" value={s.activity} onChange={(_e, v) => patch(selectedIdx, { activity: v })} />
                </FormGroup>
                <FormGroup label="Purpose" fieldId="purpose">
                  <TextInput id="purpose" value={s.purpose} onChange={(_e, v) => patch(selectedIdx, { purpose: v })} />
                </FormGroup>
                <FormGroup label="Salesforce IDs" fieldId="salesforce_ids">
                  <TextInput id="salesforce_ids" value={s.salesforce_ids} onChange={(_e, v) => patch(selectedIdx, { salesforce_ids: v })} />
                </FormGroup>
                <FormGroup label="Salesforce type" fieldId="salesforce_type">
                  <TextInput id="salesforce_type" value={s.salesforce_type} onChange={(_e, v) => patch(selectedIdx, { salesforce_type: v })} />
                </FormGroup>
                <FormGroup label="AWS regions" fieldId="aws_regions">
                  <TextInput id="aws_regions" value={s.aws_regions} onChange={(_e, v) => patch(selectedIdx, { aws_regions: v })} />
                </FormGroup>
                <FormGroup label="Count" fieldId="count">
                  <TextInput
                    id="count"
                    value={s.count == null ? '' : String(s.count)}
                    onChange={(_e, v) => patch(selectedIdx, { count: parseOptInt(v) })}
                  />
                </FormGroup>
                <FormGroup label="Provisioning (UTC)" fieldId="provisioning_date">
                  <TextInput
                    id="provisioning_date"
                    value={s.provisioning_date}
                    onChange={(_e, v) => patch(selectedIdx, { provisioning_date: v })}
                    placeholder="DD/MM/YYYY HH:MM"
                  />
                </FormGroup>
                <FormGroup label="Auto-stop (UTC)" fieldId="auto_stop">
                  <TextInput
                    id="auto_stop"
                    value={s.auto_stop}
                    onChange={(_e, v) => patch(selectedIdx, { auto_stop: v })}
                    placeholder="DD/MM/YYYY HH:MM"
                  />
                </FormGroup>
                <FormGroup label="Auto-destroy (UTC)" fieldId="auto_destroy">
                  <TextInput
                    id="auto_destroy"
                    value={s.auto_destroy}
                    onChange={(_e, v) => patch(selectedIdx, { auto_destroy: v })}
                    placeholder="DD/MM/YYYY HH:MM"
                  />
                </FormGroup>
              </div>
              <div style={{ ...formGrid, marginTop: 16 }}>
                <FormGroup label="Workshop UI" fieldId="enable_workshop_interface">
                  <Switch
                    id="enable_workshop_interface"
                    label="Enable workshop interface"
                    isChecked={s.enable_workshop_interface}
                    onChange={(_e, c) => patch(selectedIdx, { enable_workshop_interface: c })}
                  />
                </FormGroup>
                <FormGroup label="Redirect" fieldId="redirect">
                  <Switch id="redirect" label="Lab redirect" isChecked={s.redirect} onChange={(_e, c) => patch(selectedIdx, { redirect: c })} />
                </FormGroup>
                <FormGroup label="White glove" fieldId="white_glove">
                  <Switch
                    id="white_glove"
                    label="White glove mode"
                    isChecked={s.white_glove}
                    onChange={(_e, c) => patch(selectedIdx, { white_glove: c })}
                  />
                </FormGroup>
                <FormGroup label="Multi-asset" fieldId="is_multi_asset">
                  <Switch
                    id="is_multi_asset"
                    label="Multi-asset workshop"
                    isChecked={s.is_multi_asset}
                    onChange={(_e, c) => patch(selectedIdx, { is_multi_asset: c })}
                  />
                </FormGroup>
                <FormGroup label="Asset CIs" fieldId="asset_cis">
                  <TextInput id="asset_cis" value={s.asset_cis} onChange={(_e, v) => patch(selectedIdx, { asset_cis: v })} />
                </FormGroup>
                <FormGroup label="Multi workshop name" fieldId="multi_workshop_name">
                  <TextInput id="multi_workshop_name" value={s.multi_workshop_name} onChange={(_e, v) => patch(selectedIdx, { multi_workshop_name: v })} />
                </FormGroup>
                <FormGroup label="Showroom repo" fieldId="showroom_repo">
                  <TextInput id="showroom_repo" value={s.showroom_repo} onChange={(_e, v) => patch(selectedIdx, { showroom_repo: v })} />
                </FormGroup>
                <FormGroup label="Showroom ref" fieldId="showroom_ref">
                  <TextInput id="showroom_ref" value={s.showroom_ref} onChange={(_e, v) => patch(selectedIdx, { showroom_ref: v })} />
                </FormGroup>
                <FormGroup label="Showroom noVNC" fieldId="showroom_novnc">
                  <Switch
                    id="showroom_novnc"
                    label="noVNC desktop"
                    isChecked={s.showroom_novnc}
                    onChange={(_e, c) => patch(selectedIdx, { showroom_novnc: c })}
                  />
                </FormGroup>
                <FormGroup label="Showroom zerotouch" fieldId="showroom_zerotouch">
                  <Switch
                    id="showroom_zerotouch"
                    label="Zerotouch"
                    isChecked={s.showroom_zerotouch}
                    onChange={(_e, c) => patch(selectedIdx, { showroom_zerotouch: c })}
                  />
                </FormGroup>
              </div>
            </Form>
          </CardBody>
        </Card>
      )}
    </PageSection>
  );
}
