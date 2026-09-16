import { useState, useEffect } from 'react';
import { Label, Tooltip } from '@patternfly/react-core';
import { api } from '../services/api';
import { HEALTH_CHECK_INTERVAL_MS } from '../constants';
import type { HealthResponse } from '../types';

export const HealthBadge: React.FC = () => {
  const [label, setLabel] = useState('--');
  const [color, setColor] = useState<'grey' | 'green' | 'red'>('grey');
  const [tooltip, setTooltip] = useState('Checking...');

  useEffect(() => {
    const check = async () => {
      try {
        const h: HealthResponse = await api.health();
        if (h.oc_connected) {
          setLabel(`${h.user} @ ${h.cluster_url}`);
          setColor('green');
          const rhdpStatus = h.rhdp_api_reachable ? 'reachable' : 'unreachable';
          setTooltip(`Cluster: ${h.cluster_url}\nUser: ${h.user}\nBase domain: ${h.base_domain}\nRHDP API: ${rhdpStatus}`);
        } else if (h.oc_installed) {
          setLabel('oc installed, not connected');
          setColor('red');
          setTooltip(h.message || 'oc installed but cluster unreachable');
        } else {
          setLabel('oc not found');
          setColor('red');
          setTooltip(h.message || 'oc command not found');
        }
      } catch (e) {
        console.warn('Health check failed', e);
        setLabel('API unreachable');
        setColor('red');
        setTooltip('Cannot connect to RHDP-Flow backend');
      }
    };
    check();
    const id = setInterval(check, HEALTH_CHECK_INTERVAL_MS);
    return () => clearInterval(id);
  }, []);

  return (
    <Tooltip content={<span style={{ whiteSpace: 'pre-line' }}>{tooltip}</span>}>
      <Label color={color}>{label}</Label>
    </Tooltip>
  );
};
