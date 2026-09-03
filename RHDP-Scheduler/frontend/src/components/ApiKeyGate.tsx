import { useState } from 'react';
import {
  Bullseye,
  Card,
  CardTitle,
  CardBody,
  Form,
  FormGroup,
  TextInput,
  Button,
  Content,
  Alert,
  Spinner,
} from '@patternfly/react-core';

import { getApiKey, setApiKey } from '../services/api';

/**
 * Full-screen gate: until a VALID API key is present in this browser tab, the
 * app renders nothing but an "enter key" screen. The key is verified against
 * the server (a gated read endpoint) before access is granted, so an invalid
 * key re-prompts instead of dropping the user into a broken dashboard.
 */
export const ApiKeyGate: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [hasKey, setHasKey] = useState<boolean>(() => !!getApiKey());
  const [value, setValue] = useState('');
  const [validating, setValidating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (hasKey) return <>{children}</>;

  const submit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const v = value.trim();
    if (!v || validating) return;
    setValidating(true);
    setError(null);
    try {
      // Verify against a gated read endpoint before storing the key.
      const res = await fetch('/api/schedules', { headers: { 'X-API-Key': v } });
      if (res.ok) {
        setApiKey(v);
        setHasKey(true);
      } else if (res.status === 403) {
        setError('Invalid API key. Please try again.');
      } else {
        setError(`Could not verify key (server returned ${res.status}). Please try again.`);
      }
    } catch {
      setError('Could not reach the server. Please try again.');
    } finally {
      setValidating(false);
    }
  };

  return (
    <Bullseye style={{ minHeight: '100vh', padding: '1rem' }}>
      <Card style={{ maxWidth: 440, width: '100%' }}>
        <CardTitle>RHDP-Flow — API key required</CardTitle>
        <CardBody>
          {error && (
            <Alert variant="danger" isInline title={error} style={{ marginBottom: '0.75rem' }} />
          )}
          <Form onSubmit={submit}>
            <FormGroup label="Enter API key" fieldId="apikey-input">
              <TextInput
                id="apikey-input"
                type="password"
                value={value}
                onChange={(_e, v) => {
                  setValue(v);
                  if (error) setError(null);
                }}
                placeholder="RHDP_API_KEY"
                aria-label="API key"
                autoFocus
                isDisabled={validating}
              />
            </FormGroup>
            <Button type="submit" variant="primary" isBlock isDisabled={!value.trim() || validating}>
              {validating ? (
                <>
                  <Spinner size="sm" /> Verifying…
                </>
              ) : (
                'Continue'
              )}
            </Button>
          </Form>
          <Content component="small" style={{ display: 'block', marginTop: '0.75rem', opacity: 0.75 }}>
            Stored in this browser tab only (sessionStorage). Verified against the server before access.
          </Content>
        </CardBody>
      </Card>
    </Bullseye>
  );
};
