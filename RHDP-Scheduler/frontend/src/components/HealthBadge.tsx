import { useState, useEffect } from 'react';
import { Label } from '@patternfly/react-core';
import { api } from '../services/api';

export const HealthBadge: React.FC = () => {
  const [label, setLabel] = useState('--');
  const [color, setColor] = useState<'grey' | 'green' | 'red'>('grey');

  useEffect(() => {
    const check = async () => {
      try {
        const h = await api.health();
        if (h.oc_connected) {
          setLabel(`${h.user} @ ${h.cluster_url}`);
          setColor('green');
        } else if (h.oc_installed) {
          setLabel('oc installed, not connected');
          setColor('red');
        } else {
          setLabel('oc not found');
          setColor('red');
        }
      } catch {
        setLabel('API unreachable');
        setColor('red');
      }
    };
    check();
    const id = setInterval(check, 30_000);
    return () => clearInterval(id);
  }, []);

  return <Label color={color}>{label}</Label>;
};
