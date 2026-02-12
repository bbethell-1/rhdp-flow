import { useState, useEffect, useCallback } from 'react';
import {
  Toolbar,
  ToolbarContent,
  ToolbarItem,
  Button,
  FormSelect,
  FormSelectOption,
} from '@patternfly/react-core';

import { api } from '../services/api';
import type { SessionSummary, SessionDetail } from '../types';

interface Props {
  onView: (data: SessionDetail) => void;
  onBack: () => void;
  viewingSession: boolean;
  showToast: (msg: string, variant: 'success' | 'danger' | 'info') => void;
}

export const SessionHistory: React.FC<Props> = ({ onView, onBack, viewingSession, showToast }) => {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [selected, setSelected] = useState('');

  const refresh = useCallback(async () => {
    try {
      const s = await api.getSessions();
      setSessions(s);
    } catch (e) { console.warn('Failed to fetch sessions', e); }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const handleView = async () => {
    if (!selected) return;
    try {
      const data = await api.getSession(selected);
      onView(data);
      showToast(`Viewing session ${selected}`, 'info');
    } catch (e) {
      showToast(`Failed to load session: ${e}`, 'danger');
    }
  };

  if (sessions.length === 0 && !viewingSession) return null;

  return (
    <Toolbar>
      <ToolbarContent>
        <ToolbarItem>
          <span style={{ fontWeight: 600, marginRight: 8 }}>Prior sessions:</span>
        </ToolbarItem>
        <ToolbarItem>
          <FormSelect
            value={selected}
            onChange={(_e, val) => setSelected(val)}
            aria-label="Select session"
            style={{ minWidth: 220 }}
          >
            <FormSelectOption value="" label="-- select --" isPlaceholder />
            {sessions.map(s => (
              <FormSelectOption
                key={s.session_id}
                value={s.session_id}
                label={`#${s.session_id} ${s.filename} (${s.schedule_count} sched, ${s.result_count} results)`}
              />
            ))}
          </FormSelect>
        </ToolbarItem>
        <ToolbarItem>
          <Button variant="secondary" size="sm" onClick={handleView} isDisabled={!selected}>
            View
          </Button>
        </ToolbarItem>
        {viewingSession && (
          <ToolbarItem>
            <Button variant="secondary" size="sm" onClick={onBack}>
              Back to Current
            </Button>
          </ToolbarItem>
        )}
      </ToolbarContent>
    </Toolbar>
  );
};
