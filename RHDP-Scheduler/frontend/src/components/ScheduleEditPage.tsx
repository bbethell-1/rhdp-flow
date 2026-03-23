import { useState, useEffect, useCallback } from 'react';
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
} from '@patternfly/react-core';

import { api, clearApiCache } from '../services/api';
import type { WorkshopSchedule } from '../types';

function parseOptInt(s: string): number | null {
  const t = s.trim();
  if (t === '') return null;
  const n = parseInt(t, 10);
  return Number.isNaN(n) ? null : n;
}

type Props = {
  showToast: (msg: string, variant?: 'success' | 'danger' | 'info') => void;
};

export function ScheduleEditPage({ showToast }: Props) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [drafts, setDrafts] = useState<WorkshopSchedule[]>([]);
  const [selectedIdx, setSelectedIdx] = useState(0);

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
      showToast(`Saved ${drafts.length} schedule(s)`, 'success');
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

  const handleDeleteRow = async () => {
    if (drafts.length === 0) return;
    try {
      await api.deleteSchedule(selectedIdx);
      showToast('Schedule removed', 'info');
      await load();
    } catch (e) {
      showToast(`Delete failed: ${e}`, 'danger');
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
        <EmptyState titleText="No schedules loaded" headingLevel="h2">
          <EmptyStateBody>
            Upload a CSV in the main window (Upload &amp; Deploy tab), then reload this page or open the editor again.
          </EmptyStateBody>
          <Button variant="primary" onClick={load}>
            Reload from server
          </Button>
          <Button variant="link" onClick={goBack}>
            Back to app
          </Button>
        </EmptyState>
      </PageSection>
    );
  }

  return (
    <PageSection>
      <Split hasGutter style={{ marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <SplitItem>
          <Title headingLevel="h1">Edit schedules</Title>
        </SplitItem>
        <SplitItem isFilled />
        <SplitItem>
          <Button variant="link" onClick={goBack}>
            ← Back to app
          </Button>
        </SplitItem>
        <SplitItem>
          <Button variant="secondary" onClick={handleRevert} isDisabled={saving}>
            Revert
          </Button>
        </SplitItem>
        <SplitItem>
          <Button variant="primary" onClick={handleSave} isLoading={saving} isDisabled={saving}>
            Save all
          </Button>
        </SplitItem>
      </Split>

      <Alert variant="info" isInline title="Full editor" style={{ marginBottom: 16 }}>
        Changes are stored on the API. The Upload tab keeps its own copy until you refresh schedules there (e.g. reload the page or upload again).
      </Alert>

      <Card isCompact>
        <CardTitle>
          <Split hasGutter style={{ alignItems: 'center', flexWrap: 'wrap' }}>
            <SplitItem>
              <FormGroup label="Schedule" fieldId="schedule-picker" style={{ marginBottom: 0 }}>
                <FormSelect
                  id="schedule-picker"
                  value={String(selectedIdx)}
                  onChange={(_e, val) => setSelectedIdx(Number(val))}
                  aria-label="Select schedule row"
                >
                  {drafts.map((row, i) => (
                    <FormSelectOption key={i} value={String(i)} label={`${i + 1}. ${row.ci_name || row.ci}`} />
                  ))}
                </FormSelect>
              </FormGroup>
            </SplitItem>
            <SplitItem>
              <Button variant="danger" onClick={handleDeleteRow} isDisabled={saving || drafts.length === 0}>
                Delete this row
              </Button>
            </SplitItem>
          </Split>
        </CardTitle>
        <CardBody>
          {s && (
            <Form isHorizontal style={{ maxWidth: 900 }}>
              <FormGroup label="CI name" fieldId="ci_name">
                <TextInput id="ci_name" value={s.ci_name} onChange={(_e, v) => patch(selectedIdx, { ci_name: v })} />
              </FormGroup>
              <FormGroup label="CI (catalog item)" fieldId="ci">
                <TextInput id="ci" value={s.ci} onChange={(_e, v) => patch(selectedIdx, { ci: v })} />
              </FormGroup>
              <FormGroup label="Namespace" fieldId="namespace">
                <TextInput id="namespace" value={s.namespace} onChange={(_e, v) => patch(selectedIdx, { namespace: v })} />
              </FormGroup>
              <FormGroup label="Workshop name" fieldId="workshop_name">
                <TextInput id="workshop_name" value={s.workshop_name} onChange={(_e, v) => patch(selectedIdx, { workshop_name: v })} />
              </FormGroup>
              <FormGroup label="Password" fieldId="password">
                <TextInput id="password" type="password" value={s.password} onChange={(_e, v) => patch(selectedIdx, { password: v })} />
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
              <FormGroup label="Salesforce type (unprefixed IDs)" fieldId="salesforce_type">
                <TextInput id="salesforce_type" value={s.salesforce_type} onChange={(_e, v) => patch(selectedIdx, { salesforce_type: v })} />
              </FormGroup>
              <FormGroup label="AWS regions (comma-separated)" fieldId="aws_regions">
                <TextInput id="aws_regions" value={s.aws_regions} onChange={(_e, v) => patch(selectedIdx, { aws_regions: v })} />
              </FormGroup>
              <FormGroup label="Count (deploy count; empty = unset)" fieldId="count">
                <TextInput
                  id="count"
                  value={s.count == null ? '' : String(s.count)}
                  onChange={(_e, v) => patch(selectedIdx, { count: parseOptInt(v) })}
                />
              </FormGroup>
              <FormGroup label="White glove" fieldId="white_glove">
                <Switch
                  id="white_glove"
                  label="White glove mode"
                  isChecked={s.white_glove}
                  onChange={(_e, c) => patch(selectedIdx, { white_glove: c })}
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
                <TextInput id="auto_stop" value={s.auto_stop} onChange={(_e, v) => patch(selectedIdx, { auto_stop: v })} placeholder="DD/MM/YYYY HH:MM" />
              </FormGroup>
              <FormGroup label="Auto-destroy (UTC)" fieldId="auto_destroy">
                <TextInput
                  id="auto_destroy"
                  value={s.auto_destroy}
                  onChange={(_e, v) => patch(selectedIdx, { auto_destroy: v })}
                  placeholder="DD/MM/YYYY HH:MM"
                />
              </FormGroup>
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
            </Form>
          )}
        </CardBody>
      </Card>
    </PageSection>
  );
}
