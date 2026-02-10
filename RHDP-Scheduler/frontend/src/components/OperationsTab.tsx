import { useState, useRef, useEffect } from 'react';
import {
  Button,
  PageSection,
  Title,
  Card,
  CardBody,
  CardTitle,
  NumberInput,
} from '@patternfly/react-core';

import { api } from '../services/api';

interface Props {
  showToast: (msg: string, variant: 'success' | 'danger' | 'info') => void;
}

export const OperationsTab: React.FC<Props> = ({ showToast }) => {
  const [extStopDays, setExtStopDays] = useState(0);
  const [extStopHours, setExtStopHours] = useState(0);
  const [extDestroyDays, setExtDestroyDays] = useState(0);
  const [extDestroyHours, setExtDestroyHours] = useState(0);
  const [scaleCount, setScaleCount] = useState(20);
  const [logLines, setLogLines] = useState<string[]>([]);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [logLines]);

  const log = (msg: string) => {
    const ts = new Date().toLocaleTimeString();
    setLogLines(prev => [...prev, `[${ts}] ${msg}`]);
  };

  const handleLock = async () => {
    try {
      const r = await api.lock({});
      log(r.message);
      showToast(r.message, r.success ? 'success' : 'danger');
    } catch (e) {
      log(`Lock failed: ${e}`);
      showToast(`Lock failed: ${e}`, 'danger');
    }
  };

  const handleExtendStop = async () => {
    if (extStopDays === 0 && extStopHours === 0) { showToast('Specify days or hours', 'danger'); return; }
    try {
      const r = await api.extendStop({ days: extStopDays, hours: extStopHours });
      log(r.message);
      showToast(r.message, r.success ? 'success' : 'danger');
    } catch (e) {
      log(`Extend stop failed: ${e}`);
      showToast(`Extend stop failed: ${e}`, 'danger');
    }
  };

  const handleExtendDestroy = async () => {
    if (extDestroyDays === 0 && extDestroyHours === 0) { showToast('Specify days or hours', 'danger'); return; }
    try {
      const r = await api.extendDestroy({ days: extDestroyDays, hours: extDestroyHours });
      log(r.message);
      showToast(r.message, r.success ? 'success' : 'danger');
    } catch (e) {
      log(`Extend destroy failed: ${e}`);
      showToast(`Extend destroy failed: ${e}`, 'danger');
    }
  };

  const handleScale = async () => {
    try {
      const r = await api.scale({ target_count: scaleCount });
      log(r.message);
      showToast(r.message, r.success ? 'success' : 'danger');
    } catch (e) {
      log(`Scale failed: ${e}`);
      showToast(`Scale failed: ${e}`, 'danger');
    }
  };

  return (
    <PageSection>
      <div className="ops-grid" style={{ marginBottom: 16 }}>
        {/* Lock */}
        <Card>
          <CardTitle>Lock Workshops</CardTitle>
          <CardBody>
            <p style={{ marginBottom: 8 }}>Set stop time to now (immediate shutdown).</p>
            <Button variant="danger" onClick={handleLock}>Lock</Button>
          </CardBody>
        </Card>

        {/* Extend Stop */}
        <Card>
          <CardTitle>Extend Stop Time</CardTitle>
          <CardBody>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
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
            <Button variant="primary" onClick={handleExtendStop}>Extend Stop</Button>
          </CardBody>
        </Card>

        {/* Extend Destroy */}
        <Card>
          <CardTitle>Extend Destroy Time</CardTitle>
          <CardBody>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
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
            <Button variant="primary" onClick={handleExtendDestroy}>Extend Destroy</Button>
          </CardBody>
        </Card>

        {/* Scale */}
        <Card>
          <CardTitle>Scale Workshops</CardTitle>
          <CardBody>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
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
            <Button variant="primary" onClick={handleScale}>Scale</Button>
          </CardBody>
        </Card>
      </div>

      {/* Operations Log */}
      <Title headingLevel="h3" style={{ marginBottom: 8 }}>Operations Log</Title>
      <div className="log-box" ref={logRef}>
        {logLines.length > 0 ? logLines.join('\n') : 'No operations yet.'}
      </div>
    </PageSection>
  );
};
