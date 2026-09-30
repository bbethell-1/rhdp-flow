import { useState, useMemo, useCallback, useEffect } from 'react';
import {
  Alert,
  Button,
  Card,
  CardBody,
  CardTitle,
  Checkbox,
  Divider,
  Flex,
  FlexItem,
  PageSection,
  Label,
  Switch,
  FormSelect,
  FormSelectOption,
  EmptyState,
  EmptyStateBody,
  SearchInput,
  Split,
  SplitItem,
  ToggleGroup,
  ToggleGroupItem,
  Tooltip,
  FileUpload,
  ExpandableSection,
} from '@patternfly/react-core';
import SearchIcon from '@patternfly/react-icons/dist/esm/icons/search-icon';
import CheckCircleIcon from '@patternfly/react-icons/dist/esm/icons/check-circle-icon';
import ExclamationCircleIcon from '@patternfly/react-icons/dist/esm/icons/exclamation-circle-icon';
import ExclamationTriangleIcon from '@patternfly/react-icons/dist/esm/icons/exclamation-triangle-icon';
import CubesIcon from '@patternfly/react-icons/dist/esm/icons/cubes-icon';
import ExternalLinkAltIcon from '@patternfly/react-icons/dist/esm/icons/external-link-alt-icon';
import { useAutoRefresh } from '../hooks/useAutoRefresh';

import { api } from '../services/api';
import { AUTO_REFRESH_INTERVAL_MS, DEFAULT_PER_PAGE } from '../constants';
import type { QAResult, QAScopeDate, WorkshopSchedule } from '../types';
import { QAResultsTable } from './QAResultsTable';
import { DestroyQASection } from './DestroyQASection';

interface Props {
  qaResults: QAResult[];
  setQAResults: (r: QAResult[]) => void;
  showToast: (msg: string, variant: 'success' | 'danger' | 'info') => void;
  schedules?: WorkshopSchedule[];
}

type SortableQAColumn = 'ci_name' | 'ci' | 'status';
type QAStatusFilter = 'all' | 'verified' | 'failed' | 'unhealthy';
type FloorMode = 'day' | 'event';
type TimeBand = 'morning' | 'midday' | 'afternoon';

const ALL_NAMESPACES = '__all__';
const ALL_BANDS = '__all__';

function readFloorFromUrl(): { floor: FloorMode; floorDate: string | null } {
  if (typeof window === 'undefined') return { floor: 'event', floorDate: null };
  const q = new URLSearchParams(window.location.search);
  const floorDate = q.get('floor_date');
  if (q.get('floor') === 'event') return { floor: 'event', floorDate };
  if (floorDate) return { floor: 'day', floorDate };
  return { floor: 'event', floorDate: null };
}

function scheduleFloorDate(s: WorkshopSchedule): string | null {
  const explicit = (s.session_date || '').trim().slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(explicit)) return explicit;
  const m = (s.provisioning_date || '')
    .trim()
    .match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (!m) return null;
  const yr = m[3].length === 2 ? 2000 + parseInt(m[3], 10) : parseInt(m[3], 10);
  return `${yr}-${String(parseInt(m[2], 10)).padStart(2, '0')}-${String(parseInt(m[1], 10)).padStart(2, '0')}`;
}

function isVerified(status: string): boolean {
  const s = (status || '').toLowerCase();
  return s.includes('verified') && !s.includes('unverified');
}

function isFailed(status: string): boolean {
  const s = (status || '').toLowerCase();
  return s.includes('failed') || s.includes('error');
}

function isUnhealthy(r: QAResult): boolean {
  const h = r.healthy;
  return h === false || h === 'No' || h === 'no';
}

function StatusCard({
  icon: Icon,
  color,
  count,
  label,
  tooltip,
  onClick,
  active,
}: {
  icon: React.ComponentType<{ style?: React.CSSProperties }>;
  color: string;
  count: number;
  label: string;
  tooltip: string;
  onClick?: () => void;
  active?: boolean;
}) {
  return (
    <Tooltip content={tooltip}>
      <Card
        isCompact
        isPlain
        onClick={onClick}
        style={{
          cursor: onClick ? 'pointer' : undefined,
          ...(active ? { outline: `2px solid ${color}`, outlineOffset: 2 } : {}),
        }}
      >
        <CardBody>
          <div className="summary-card-value" style={{ color }}>
            <Icon style={{ marginRight: 4 }} />
            {count}
          </div>
          <div className="summary-card-label">{label}</div>
        </CardBody>
      </Card>
    </Tooltip>
  );
}

export const QATab: React.FC<Props> = ({
  qaResults,
  setQAResults,
  showToast,
  schedules = [],
}) => {
  const scheduleNamespaces = useMemo(
    () => [...new Set(schedules.map((s) => s.namespace).filter(Boolean))],
    [schedules],
  );

  const [qaType, setQaType] = useState<'1' | '2' | '3' | 'both' | 'all'>('all');
  const [runNamespace, setRunNamespace] = useState<string>(() =>
    scheduleNamespaces.length === 1 ? scheduleNamespaces[0] : ALL_NAMESPACES,
  );
  const initialFloor = readFloorFromUrl();
  const [floor, setFloor] = useState<FloorMode>(initialFloor.floor);
  const [floorDate, setFloorDate] = useState<string | null>(initialFloor.floorDate);
  const [timeBand, setTimeBand] = useState<string>(ALL_BANDS);
  const [scopeDates, setScopeDates] = useState<QAScopeDate[]>([]);
  const [selectedCiNames, setSelectedCiNames] = useState<Set<string>>(new Set());
  const [showWorkshopPicker, setShowWorkshopPicker] = useState(false);
  const [running, setRunning] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [groupByNamespace, setGroupByNamespace] = useState(
    () => scheduleNamespaces.length > 1,
  );
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [csvUploading, setCsvUploading] = useState(false);
  const [showAdhoc, setShowAdhoc] = useState(false);
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(DEFAULT_PER_PAGE);
  const [sortBy, setSortBy] = useState<SortableQAColumn | null>('ci_name');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [qaSearch, setQaSearch] = useState('');
  const [qaStatusFilter, setQaStatusFilter] = useState<QAStatusFilter>('all');
  const [viewNamespace, setViewNamespace] = useState<string>(ALL_NAMESPACES);
  const isEmbedded =
    typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).get('embedded') === 'true';
  const [adminOpsUrl, setAdminOpsUrl] = useState(
    'https://babylon-catalog.apps.ocp-us-west-2.infra.open.redhat.com/admin/ops',
  );
  const [labagatorBabylonPath, setLabagatorBabylonPath] = useState('/babylon');
  const adminOpsHref = isEmbedded ? labagatorBabylonPath : adminOpsUrl;
  const adminOpsTarget = isEmbedded ? '_parent' : '_blank';

  useEffect(() => {
    api
      .health()
      .then((h) => {
        if (h.admin_ops_url) setAdminOpsUrl(h.admin_ops_url);
        if (h.labagator_babylon_path) setLabagatorBabylonPath(h.labagator_babylon_path);
      })
      .catch(() => {
        /* keep defaults */
      });
  }, []);

  // Keep run scope in sync when schedules load / change (prefer single NS)
  useEffect(() => {
    if (scheduleNamespaces.length === 1) {
      setRunNamespace(scheduleNamespaces[0]);
      setGroupByNamespace(false);
    } else if (scheduleNamespaces.length > 1) {
      setRunNamespace((prev) =>
        prev !== ALL_NAMESPACES && scheduleNamespaces.includes(prev)
          ? prev
          : ALL_NAMESPACES,
      );
      setGroupByNamespace(true);
    }
  }, [scheduleNamespaces]);

  // Floor day options from schedules (Session Date / provisioning day)
  useEffect(() => {
    const ns = runNamespace === ALL_NAMESPACES ? undefined : runNamespace;
    let cancelled = false;
    api
      .qaScopes(ns)
      .then((res) => {
        if (cancelled) return;
        const dates = res.dates || [];
        setScopeDates(dates);
        setFloorDate((prev) => {
          if (prev && dates.some((d) => d.date === prev)) return prev;
          return dates[0]?.date ?? prev;
        });
        // Multi-day schedules default to This day (Ops Floor pin), unless URL
        // explicitly asks for Full event (?floor=event).
        const q = new URLSearchParams(window.location.search);
        if (dates.length > 1 && q.get('floor') !== 'event' && !q.get('floor_date')) {
          setFloor((prev) => (prev === 'event' && !initialFloor.floorDate ? 'day' : prev));
        }
      })
      .catch(() => {
        if (!cancelled) setScopeDates([]);
      });
    return () => {
      cancelled = true;
    };
    // initialFloor.floorDate is mount-stable from URL
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schedules, runNamespace]);

  const refreshQA = useCallback(async () => {
    try {
      const data = await api.qaResults();
      setQAResults(data.results);
    } catch (e) {
      console.warn('Auto-refresh QA results failed', e);
    }
  }, [setQAResults]);

  useAutoRefresh(refreshQA, AUTO_REFRESH_INTERVAL_MS, autoRefresh);

  const selectedDayMeta = useMemo(
    () => scopeDates.find((d) => d.date === floorDate) || null,
    [scopeDates, floorDate],
  );

  /** Schedules in the current Floor / namespace / band scope (candidates for QA). */
  const scopedSchedules = useMemo(() => {
    let rows = schedules;
    if (runNamespace !== ALL_NAMESPACES) {
      rows = rows.filter((s) => s.namespace === runNamespace);
    }
    if (floor === 'day' && floorDate) {
      rows = rows.filter((s) => scheduleFloorDate(s) === floorDate);
    }
    if (floor === 'day' && timeBand !== ALL_BANDS) {
      rows = rows.filter((s) => {
        const m = (s.provisioning_date || '')
          .trim()
          .match(/^\d{1,2}\/\d{1,2}\/\d{2,4}\s+(\d{1,2}):(\d{2})/);
        if (!m) return true;
        const minutes = parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
        if (timeBand === 'morning') return minutes < 12 * 60;
        if (timeBand === 'midday') return minutes >= 12 * 60 && minutes < 15 * 60;
        if (timeBand === 'afternoon') return minutes >= 15 * 60;
        return true;
      });
    }
    return rows;
  }, [schedules, runNamespace, floor, floorDate, timeBand]);

  const workshopsInScope = scopedSchedules.length;
  const scopedCiNames = useMemo(
    () => [...new Set(scopedSchedules.map((s) => s.ci_name).filter(Boolean))],
    [scopedSchedules],
  );

  // When Floor/namespace/band changes, default to all workshops in that scope
  // (multi-day: pick a day, then optionally deselect not-yet-deployed rows).
  useEffect(() => {
    setSelectedCiNames(new Set(scopedCiNames));
  }, [scopedCiNames]);

  const selectedCount = useMemo(
    () => scopedCiNames.filter((n) => selectedCiNames.has(n)).length,
    [scopedCiNames, selectedCiNames],
  );
  const allInScopeSelected =
    scopedCiNames.length > 0 && selectedCount === scopedCiNames.length;

  const failedCiNames = useMemo(
    () =>
      [
        ...new Set(
          qaResults.filter((r) => isFailed(r.status)).map((r) => r.ci_name).filter(Boolean),
        ),
      ],
    [qaResults],
  );

  const runScopeLabel = useMemo(() => {
    const nsPart =
      runNamespace === ALL_NAMESPACES
        ? scheduleNamespaces.length > 0
          ? `all ${scheduleNamespaces.length} namespace(s)`
          : 'loaded schedules'
        : runNamespace;
    const pick =
      scopedCiNames.length > 0 && selectedCount < scopedCiNames.length
        ? ` · ${selectedCount}/${scopedCiNames.length} selected`
        : '';
    if (floor === 'day' && floorDate) {
      const dayLabel = selectedDayMeta?.label || floorDate;
      const band =
        timeBand !== ALL_BANDS
          ? selectedDayMeta?.bands.find((b) => b.key === timeBand)?.label || timeBand
          : null;
      return `${dayLabel}${band ? ` · ${band}` : ''} · ${nsPart}${pick}`;
    }
    return `Full event · ${nsPart}${pick}`;
  }, [
    runNamespace,
    scheduleNamespaces.length,
    floor,
    floorDate,
    timeBand,
    selectedDayMeta,
    scopedCiNames.length,
    selectedCount,
  ]);

  const runQAForCiNames = async (ciNames: string[] | null, label: string) => {
    if (floor === 'day' && !floorDate) {
      showToast('Pick a floor day (or switch to Full event)', 'danger');
      return;
    }
    if (ciNames && ciNames.length === 0) {
      showToast('Select at least one workshop to QA', 'danger');
      return;
    }
    setRunning(true);
    try {
      const body: Parameters<typeof api.runQA>[0] = {
        type: qaType,
        floor,
        floor_date: floor === 'day' ? floorDate : null,
        time_band:
          floor === 'day' && timeBand !== ALL_BANDS
            ? (timeBand as TimeBand)
            : null,
      };
      if (runNamespace !== ALL_NAMESPACES) {
        body.namespaces = [runNamespace];
      }
      if (ciNames) {
        body.ci_names = ciNames;
      }
      const data = await api.runQA(body);
      setQAResults(data.results);
      setViewNamespace(ALL_NAMESPACES);
      setQaStatusFilter('all');
      setPage(1);
      const ran = data.ran_count ?? data.count;
      showToast(
        ciNames
          ? `QA complete: re-checked ${ran} · ${data.count} total result(s) (${label})`
          : `QA complete: ${data.count} result(s) for ${label}`,
        'success',
      );
    } catch (e) {
      showToast(`QA failed: ${e}`, 'danger');
    } finally {
      setRunning(false);
    }
  };

  const handleRun = async () => {
    const subset =
      scopedCiNames.length > 0 && selectedCount < scopedCiNames.length
        ? scopedCiNames.filter((n) => selectedCiNames.has(n))
        : null;
    await runQAForCiNames(subset, runScopeLabel);
  };

  const handleRetryFailed = async () => {
    if (failedCiNames.length === 0) {
      showToast('No failed QA rows to retry', 'info');
      return;
    }
    setSelectedCiNames(new Set(failedCiNames));
    setShowWorkshopPicker(true);
    await runQAForCiNames(failedCiNames, `retry failed (${failedCiNames.length})`);
  };

  const toggleCiSelected = (ciName: string, checked: boolean) => {
    setSelectedCiNames((prev) => {
      const next = new Set(prev);
      if (checked) next.add(ciName);
      else next.delete(ciName);
      return next;
    });
  };

  const handleRefresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      const data = await api.qaResults();
      setQAResults(data.results);
      showToast(`Refreshed: ${data.count} QA result(s)`, 'success');
    } catch (e) {
      showToast(`Refresh failed: ${e}`, 'danger');
    } finally {
      setRefreshing(false);
    }
  };

  const handleCsvUpload = async (file: File | null) => {
    if (!file) {
      setCsvFile(null);
      return;
    }
    setCsvFile(file);
    setCsvUploading(true);
    try {
      const text = await file.text();
      const lines = text.split('\n').filter((l) => l.trim());
      if (lines.length < 2) {
        showToast('CSV must have header and at least one row', 'danger');
        setCsvUploading(false);
        return;
      }
      const headers = lines[0].toLowerCase().split(',').map((h) => h.trim());
      const nsIdx = headers.indexOf('namespace');
      if (nsIdx === -1) {
        showToast('CSV must have a "Namespace" column', 'danger');
        setCsvUploading(false);
        return;
      }
      const namespaces = Array.from(
        new Set(
          lines
            .slice(1)
            .map((line) => {
              const cells = line.split(',');
              return cells[nsIdx]?.trim();
            })
            .filter((ns): ns is string => !!ns && ns.length > 0),
        ),
      );

      if (namespaces.length === 0) {
        showToast('No valid namespaces found in CSV', 'danger');
        setCsvUploading(false);
        return;
      }

      const data = await api.runQA({ type: qaType, namespaces });
      setQAResults(data.results);
      showToast(
        `QA complete from CSV: ${data.count} result(s) across ${namespaces.length} namespace(s)`,
        'success',
      );
    } catch (e) {
      showToast(`CSV QA failed: ${e}`, 'danger');
    } finally {
      setCsvUploading(false);
    }
  };

  const resultNamespaces = useMemo(
    () => [...new Set(qaResults.map((r) => r.namespace || '').filter(Boolean))].sort(),
    [qaResults],
  );

  const statusCounts = useMemo(() => {
    const counts = {
      total: qaResults.length,
      verified: 0,
      failed: 0,
      unhealthy: 0,
      landing: 0,
    };
    for (const r of qaResults) {
      if (isVerified(r.status)) counts.verified++;
      else if (isFailed(r.status)) counts.failed++;
      if (isUnhealthy(r)) counts.unhealthy++;
      if (r.landing_page_url) counts.landing++;
    }
    return counts;
  }, [qaResults]);

  const filteredQAResults = useMemo(() => {
    let filtered = qaResults;
    if (viewNamespace !== ALL_NAMESPACES) {
      filtered = filtered.filter((r) => (r.namespace || '') === viewNamespace);
    }
    if (qaStatusFilter !== 'all') {
      filtered = filtered.filter((r) => {
        if (qaStatusFilter === 'verified') return isVerified(r.status);
        if (qaStatusFilter === 'failed') return isFailed(r.status);
        if (qaStatusFilter === 'unhealthy') return isUnhealthy(r);
        return true;
      });
    }
    if (qaSearch) {
      const q = qaSearch.toLowerCase();
      filtered = filtered.filter(
        (r) =>
          r.ci_name.toLowerCase().includes(q) ||
          r.ci.toLowerCase().includes(q) ||
          (r.namespace || '').toLowerCase().includes(q) ||
          (r.status || '').toLowerCase().includes(q) ||
          String(r.issues || '').toLowerCase().includes(q),
      );
    }
    return filtered;
  }, [qaResults, qaStatusFilter, qaSearch, viewNamespace]);

  const isQAFiltered =
    qaStatusFilter !== 'all' ||
    qaSearch.length > 0 ||
    viewNamespace !== ALL_NAMESPACES;
  const qaTitle = isQAFiltered
    ? `QA Results (${filteredQAResults.length} of ${qaResults.length})`
    : `QA Results (${qaResults.length})`;

  const handleDownloadFilteredCSV = () => {
    const headers = [
      'CI Name',
      'Namespace',
      'CI',
      'Status',
      'Deployed',
      'Healthy',
      'Expected Seats',
      'Actual Seats',
      'Issues',
      'Landing Page URL',
    ];
    const rows = filteredQAResults.map((r) => {
      const rec = r as QAResult & {
        expected_seats?: unknown;
        actual_seats?: unknown;
        actual_users?: unknown;
      };
      const deployedYes = String(r.deployed || '').trim().toLowerCase() === 'yes';
      const expRaw = rec.expected_users ?? rec.expected_seats;
      const expCsv =
        expRaw === null || expRaw === undefined || expRaw === ''
          ? ''
          : String(expRaw);
      let actCsv = '';
      if (deployedYes) {
        const a = rec.actual_count ?? rec.actual_seats ?? rec.actual_users;
        actCsv = a === null || a === undefined || a === '' ? '' : String(a);
      }
      return [
        r.ci_name,
        r.namespace || '',
        r.ci,
        r.status,
        r.deployed,
        String(r.healthy ?? ''),
        expCsv,
        actCsv,
        String(r.issues || ''),
        r.landing_page_url || '',
      ]
        .map((v) => `"${String(v).replace(/"/g, '""')}"`)
        .join(',');
    });
    const csv = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `qa-results-${qaStatusFilter}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const noSchedules = schedules.length === 0;

  return (
    <PageSection>
      <Alert variant="info" isInline isPlain title="Keep it simple" style={{ marginBottom: 16 }}>
        <strong>QA</strong> = Catalog → Setup → Healthy (match Ops Floor day when scoped).
        {' '}
        <strong>Admin Ops</strong> = live workshops + ad-hoc lock/extend/scale.
        {' '}
        <Button
          component="a"
          variant="link"
          isInline
          icon={<ExternalLinkAltIcon />}
          iconPosition="end"
          href={adminOpsHref}
          target={adminOpsTarget}
          rel="noopener noreferrer"
          style={{ paddingInline: 0, fontWeight: 600 }}
        >
          {isEmbedded ? 'Admin Ops (Labagator)' : 'Admin Ops'}
        </Button>
      </Alert>

      {/* Floor day + namespace + type + run — Floor scope first so multi-day events stay quiet */}
      <Card isCompact style={{ marginBottom: 16 }}>
        <CardTitle>Catalog → Setup → Healthy</CardTitle>
        <CardBody>
          <p style={{ marginTop: 0, marginBottom: 12, fontSize: '0.9rem', opacity: 0.85 }}>
            Pick <strong>This day</strong> (Ops Floor pin) or <strong>Full event</strong>, then Run QA.
            {floor === 'day' && selectedDayMeta ? (
              <>
                {' '}
                Scoped to <strong>{selectedDayMeta.label}</strong> ({workshopsInScope} workshop
                {workshopsInScope === 1 ? '' : 's'}).
              </>
            ) : null}
          </p>
          <Split hasGutter style={{ alignItems: 'flex-start', flexWrap: 'wrap' }}>
            <SplitItem>
              <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: 4 }}>
                Floor scope
              </label>
              <ToggleGroup aria-label="QA floor scope: this day or full event">
                <ToggleGroupItem
                  text="This day"
                  buttonId="qa-floor-day"
                  isSelected={floor === 'day'}
                  onChange={() => {
                    setFloor('day');
                    if (!floorDate && scopeDates[0]) setFloorDate(scopeDates[0].date);
                  }}
                  isDisabled={noSchedules || scopeDates.length === 0}
                />
                <ToggleGroupItem
                  text="Full event"
                  buttonId="qa-floor-event"
                  isSelected={floor === 'event'}
                  onChange={() => setFloor('event')}
                  isDisabled={noSchedules}
                />
              </ToggleGroup>
            </SplitItem>
            {floor === 'day' ? (
              <SplitItem>
                <label htmlFor="qa-floor-date" style={{ display: 'block', fontSize: '0.85rem', marginBottom: 4 }}>
                  Floor day
                </label>
                <FormSelect
                  id="qa-floor-date"
                  value={floorDate || ''}
                  onChange={(_e, val) => {
                    setFloorDate(val || null);
                    setTimeBand(ALL_BANDS);
                  }}
                  aria-label="QA floor day"
                  isDisabled={scopeDates.length === 0}
                  style={{ width: 200 }}
                >
                  {scopeDates.length === 0 ? (
                    <FormSelectOption value="" label="No floor days in schedule" />
                  ) : (
                    scopeDates.map((d) => (
                      <FormSelectOption
                        key={d.date}
                        value={d.date}
                        label={`${d.label} (${d.count})`}
                      />
                    ))
                  )}
                </FormSelect>
              </SplitItem>
            ) : null}
            {floor === 'day' && selectedDayMeta && selectedDayMeta.bands.length > 1 ? (
              <SplitItem>
                <label htmlFor="qa-time-band" style={{ display: 'block', fontSize: '0.85rem', marginBottom: 4 }}>
                  Time band
                </label>
                <FormSelect
                  id="qa-time-band"
                  value={timeBand}
                  onChange={(_e, val) => setTimeBand(val)}
                  aria-label="QA time band"
                  style={{ width: 180 }}
                >
                  <FormSelectOption
                    value={ALL_BANDS}
                    label={`Whole day (${selectedDayMeta.count})`}
                  />
                  {selectedDayMeta.bands.map((b) => (
                    <FormSelectOption
                      key={b.key}
                      value={b.key}
                      label={`${b.label} (${b.count})`}
                    />
                  ))}
                </FormSelect>
              </SplitItem>
            ) : null}
            <SplitItem>
              <label htmlFor="qa-namespace-select" style={{ display: 'block', fontSize: '0.85rem', marginBottom: 4 }}>
                Namespace scope
              </label>
              <FormSelect
                id="qa-namespace-select"
                value={runNamespace}
                onChange={(_e, val) => setRunNamespace(val)}
                aria-label="QA namespace scope"
                isDisabled={noSchedules && scheduleNamespaces.length === 0}
                style={{ width: 280 }}
              >
                <FormSelectOption
                  value={ALL_NAMESPACES}
                  label={
                    scheduleNamespaces.length
                      ? `All namespaces (${scheduleNamespaces.length})`
                      : 'All namespaces (from schedules)'
                  }
                />
                {scheduleNamespaces.map((ns) => (
                  <FormSelectOption
                    key={ns}
                    value={ns}
                    label={`${ns} (${schedules.filter((s) => s.namespace === ns).length})`}
                  />
                ))}
              </FormSelect>
            </SplitItem>
            <SplitItem>
              <label htmlFor="qa-type-select" style={{ display: 'block', fontSize: '0.85rem', marginBottom: 4 }}>
                QA type
              </label>
              <FormSelect
                id="qa-type-select"
                value={qaType}
                onChange={(_e, val) => setQaType(val as typeof qaType)}
                aria-label="QA type"
                className="qa-type-select"
                style={{ width: 240 }}
              >
                <FormSelectOption value="1" label="QA1 - Verify Catalog Items" />
                <FormSelectOption value="2" label="QA2 - Verify Setup" />
                <FormSelectOption value="3" label="QA3 - Verify Deployment" />
                <FormSelectOption value="both" label="Both (QA2 + QA3)" />
                <FormSelectOption value="all" label="All (QA1 + QA2 + QA3)" />
              </FormSelect>
            </SplitItem>
            <SplitItem style={{ paddingTop: 22 }}>
              <Tooltip
                content={
                  noSchedules
                    ? 'Upload a schedule CSV first'
                    : selectedCount === 0
                      ? 'Select at least one workshop below'
                      : `Scan ${selectedCount} of ${workshopsInScope} workshop(s) in ${runScopeLabel}`
                }
              >
                <Button
                  variant="primary"
                  onClick={() => void handleRun()}
                  isDisabled={running || noSchedules || selectedCount === 0}
                  isLoading={running}
                >
                  {runNamespace === ALL_NAMESPACES
                    ? allInScopeSelected
                      ? 'Run QA'
                      : `Run QA (${selectedCount})`
                    : `Run QA for ${runNamespace.replace(/^user-/, '').replace(/-redhat-com$/, '')}${
                        allInScopeSelected ? '' : ` (${selectedCount})`
                      }`}
                </Button>
              </Tooltip>
            </SplitItem>
            <SplitItem style={{ paddingTop: 22 }}>
              <Tooltip content="Re-run Catalog→Setup→Healthy only for rows that failed last time (keeps prior passes)">
                <Button
                  variant="secondary"
                  onClick={() => void handleRetryFailed()}
                  isDisabled={running || failedCiNames.length === 0}
                >
                  Retry failed{failedCiNames.length ? ` (${failedCiNames.length})` : ''}
                </Button>
              </Tooltip>
            </SplitItem>
            <SplitItem style={{ paddingTop: 22 }}>
              <Button
                variant="secondary"
                onClick={handleRefresh}
                isLoading={refreshing}
                isDisabled={refreshing}
              >
                Refresh
              </Button>
            </SplitItem>
            <SplitItem style={{ paddingTop: 26 }}>
              <Tooltip content="Poll for updated QA results every 15 seconds">
                <Switch
                  id="qa-auto-refresh"
                  label="Auto-refresh (15s)"
                  isChecked={autoRefresh}
                  onChange={(_e, checked) => setAutoRefresh(checked)}
                />
              </Tooltip>
            </SplitItem>
          </Split>
          <p className="qa-type-hint" style={{ marginTop: 8, marginBottom: 0 }}>
            {noSchedules && (
              <>Load schedules on Upload &amp; Deploy first, then run QA against your namespace.</>
            )}
            {!noSchedules && qaType === '1' && (
              <>Catalog CIs in the CSV exist on the cluster (typo catch — run first).</>
            )}
            {!noSchedules && qaType === '2' && (
              <>Compares live workshops to your schedule — dates, seats, and config.</>
            )}
            {!noSchedules && qaType === '3' && (
              <>Health, seats, URLs. Showroom column = full batched Soundcheck (status + deep-link).</>
            )}
            {!noSchedules && qaType === 'both' && (
              <>Setup verification + deployment checks (one row per workshop).</>
            )}
            {!noSchedules && qaType === 'all' && (
              <>Full suite: catalog → setup → deployment + Soundcheck.</>
            )}
            {!noSchedules && (
              <>
                {' '}
                Scope: <strong>{runScopeLabel}</strong>
                {workshopsInScope > 0 && (
                  <>
                    {' '}
                    · {selectedCount}/{workshopsInScope} workshop(s) selected
                  </>
                )}
                . For multi-day events, pin This day (or Full event), then deselect
                workshops not deployed yet — or use Retry failed after a run.
              </>
            )}
          </p>

          {!noSchedules && scopedCiNames.length > 0 ? (
            <ExpandableSection
              toggleText={`Select workshops to QA (${selectedCount}/${scopedCiNames.length})`}
              isExpanded={showWorkshopPicker}
              onToggle={(_e, expanded) => setShowWorkshopPicker(expanded)}
              style={{ marginTop: 12 }}
            >
              <Flex
                gap={{ default: 'gapSm' }}
                style={{ marginBottom: 8 }}
                alignItems={{ default: 'alignItemsCenter' }}
              >
                <Button
                  variant="link"
                  isInline
                  onClick={() => setSelectedCiNames(new Set(scopedCiNames))}
                >
                  Select all in scope
                </Button>
                <Button
                  variant="link"
                  isInline
                  onClick={() => setSelectedCiNames(new Set())}
                >
                  Clear
                </Button>
                {failedCiNames.length > 0 ? (
                  <Button
                    variant="link"
                    isInline
                    onClick={() => setSelectedCiNames(new Set(failedCiNames))}
                  >
                    Select failed only ({failedCiNames.length})
                  </Button>
                ) : null}
              </Flex>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
                  gap: '6px 12px',
                  maxHeight: 220,
                  overflow: 'auto',
                  padding: '4px 2px',
                }}
              >
                {scopedSchedules.map((s) => {
                  const key = `${s.ci_name}::${s.namespace}`;
                  return (
                    <Checkbox
                      key={key}
                      id={`qa-pick-${key}`}
                      label={
                        <span title={`${s.ci_name} · ${s.namespace}`}>
                          <strong>{s.ci_name}</strong>
                          <span style={{ opacity: 0.65, fontSize: '0.85em' }}>
                            {' '}
                            · {s.namespace}
                          </span>
                        </span>
                      }
                      isChecked={selectedCiNames.has(s.ci_name)}
                      onChange={(_e, checked) => toggleCiSelected(s.ci_name, checked)}
                    />
                  );
                })}
              </div>
            </ExpandableSection>
          ) : null}
        </CardBody>
      </Card>

      <ExpandableSection
        toggleText="Ad-hoc QA from CSV (namespaces only)"
        isExpanded={showAdhoc}
        onToggle={(_e, expanded) => setShowAdhoc(expanded)}
        style={{ marginBottom: 16 }}
      >
        <Card isCompact>
          <CardBody>
            <Split hasGutter style={{ alignItems: 'center' }}>
              <SplitItem style={{ flexGrow: 1, maxWidth: 400 }}>
                <FileUpload
                  id="qa-csv-upload"
                  type="text"
                  value={csvFile || undefined}
                  filename={csvFile?.name || ''}
                  filenamePlaceholder="Upload CSV with a Namespace column"
                  onFileInputChange={(_e, file) => handleCsvUpload(file)}
                  onClearClick={() => setCsvFile(null)}
                  isLoading={csvUploading}
                  browseButtonText="Browse..."
                  clearButtonText="Clear"
                />
              </SplitItem>
              <SplitItem>
                <Label color="blue" icon={<SearchIcon />}>
                  Ad-hoc
                </Label>
              </SplitItem>
            </Split>
          </CardBody>
        </Card>
      </ExpandableSection>

      {qaResults.length > 0 && (
        <Flex style={{ marginBottom: 16 }} gap={{ default: 'gapMd' }}>
          <FlexItem>
            <StatusCard
              icon={CubesIcon}
              color="var(--pf-t--global--text--color--regular)"
              count={statusCounts.total}
              label="Total"
              tooltip="All QA result rows"
              onClick={() => {
                setQaStatusFilter('all');
                setViewNamespace(ALL_NAMESPACES);
                setPage(1);
              }}
              active={qaStatusFilter === 'all' && viewNamespace === ALL_NAMESPACES}
            />
          </FlexItem>
          <FlexItem>
            <StatusCard
              icon={CheckCircleIcon}
              color="var(--pf-v6-global--success-color--100)"
              count={statusCounts.verified}
              label="Verified"
              tooltip="Passed QA verification"
              onClick={() => {
                setQaStatusFilter('verified');
                setPage(1);
              }}
              active={qaStatusFilter === 'verified'}
            />
          </FlexItem>
          <FlexItem>
            <StatusCard
              icon={ExclamationCircleIcon}
              color="var(--pf-v6-global--danger-color--100)"
              count={statusCounts.failed}
              label="Failed"
              tooltip="Failed QA checks — see Issues column"
              onClick={() => {
                setQaStatusFilter('failed');
                setPage(1);
              }}
              active={qaStatusFilter === 'failed'}
            />
          </FlexItem>
          <FlexItem>
            <StatusCard
              icon={ExclamationTriangleIcon}
              color="var(--pf-v6-global--warning-color--100)"
              count={statusCounts.unhealthy}
              label="Unhealthy"
              tooltip="Deployed but health check failed"
              onClick={() => {
                setQaStatusFilter('unhealthy');
                setPage(1);
              }}
              active={qaStatusFilter === 'unhealthy'}
            />
          </FlexItem>
          <FlexItem>
            <StatusCard
              icon={ExternalLinkAltIcon}
              color="var(--pf-v6-global--info-color--100)"
              count={statusCounts.landing}
              label="Landing URLs"
              tooltip="Rows with a student landing page URL (also on Students tab)"
            />
          </FlexItem>
        </Flex>
      )}

      {qaResults.length > 0 && (
        <Split hasGutter style={{ marginBottom: 16, alignItems: 'center', flexWrap: 'wrap' }}>
          <SplitItem>
            <Button
              variant="secondary"
              onClick={handleDownloadFilteredCSV}
              isDisabled={filteredQAResults.length === 0}
            >
              Download{isQAFiltered ? ' Filtered' : ''} CSV
            </Button>
          </SplitItem>
          {resultNamespaces.length > 1 && (
            <SplitItem>
              <FormSelect
                value={viewNamespace}
                onChange={(_e, val) => {
                  setViewNamespace(val);
                  setPage(1);
                }}
                aria-label="Filter QA results by namespace"
                style={{ width: 260 }}
              >
                <FormSelectOption value={ALL_NAMESPACES} label="All namespaces (view)" />
                {resultNamespaces.map((ns) => (
                  <FormSelectOption key={ns} value={ns} label={ns} />
                ))}
              </FormSelect>
            </SplitItem>
          )}
          <SplitItem>
            <Tooltip content="Group results by namespace with collapsible sections">
              <Switch
                id="qa-group-by-namespace"
                label="Group by Namespace"
                isChecked={groupByNamespace}
                onChange={(_e, checked) => setGroupByNamespace(checked)}
              />
            </Tooltip>
          </SplitItem>
          <SplitItem isFilled />
          <SplitItem>
            <SearchInput
              placeholder="Search workshop, CI, namespace, issues..."
              value={qaSearch}
              onChange={(_e, val) => {
                setQaSearch(val);
                setPage(1);
              }}
              onClear={() => {
                setQaSearch('');
                setPage(1);
              }}
              style={{ width: 280 }}
            />
          </SplitItem>
          <SplitItem>
            <ToggleGroup aria-label="QA status filter">
              <ToggleGroupItem
                buttonId="qa-filter-all"
                text="All"
                isSelected={qaStatusFilter === 'all'}
                onChange={() => {
                  setQaStatusFilter('all');
                  setPage(1);
                }}
              />
              <ToggleGroupItem
                buttonId="qa-filter-verified"
                text="Verified"
                isSelected={qaStatusFilter === 'verified'}
                onChange={() => {
                  setQaStatusFilter('verified');
                  setPage(1);
                }}
              />
              <ToggleGroupItem
                buttonId="qa-filter-failed"
                text="Failed"
                isSelected={qaStatusFilter === 'failed'}
                onChange={() => {
                  setQaStatusFilter('failed');
                  setPage(1);
                }}
              />
              <ToggleGroupItem
                buttonId="qa-filter-unhealthy"
                text="Unhealthy"
                isSelected={qaStatusFilter === 'unhealthy'}
                onChange={() => {
                  setQaStatusFilter('unhealthy');
                  setPage(1);
                }}
              />
            </ToggleGroup>
          </SplitItem>
        </Split>
      )}

      {qaResults.length === 0 && (
        <div className="ops-grid" style={{ marginBottom: 16 }}>
          <Card isCompact>
            <CardTitle>QA1 — Verify Catalog Items</CardTitle>
            <CardBody style={{ fontSize: '0.85rem' }}>
              <p>
                <strong>When:</strong> Before deploy — CSV hygiene (fastest).
              </p>
              <p>
                <strong>What it checks:</strong>
              </p>
              <ul style={{ margin: '4px 0 0', paddingLeft: 20 }}>
                <li>Every CI in the schedule exists in babylon-catalog-*</li>
                <li>Catches typos / wrong suffixes before provision fails</li>
              </ul>
            </CardBody>
          </Card>
          <Card isCompact>
            <CardTitle>QA2 — Verify Setup</CardTitle>
            <CardBody style={{ fontSize: '0.85rem' }}>
              <p>
                <strong>When:</strong> Immediately after deploying workshops.
              </p>
              <p>
                <strong>What it checks:</strong>
              </p>
              <ul style={{ margin: '4px 0 0', paddingLeft: 20 }}>
                <li>Workshop resources exist in the namespace</li>
                <li>Dates and seat counts match the schedule</li>
                <li>Workshop interface settings match</li>
              </ul>
            </CardBody>
          </Card>
          <Card isCompact>
            <CardTitle>QA3 — Verify Deployment</CardTitle>
            <CardBody style={{ fontSize: '0.85rem' }}>
              <p>
                <strong>When:</strong> 10–30 minutes after deploy.
              </p>
              <p>
                <strong>What it checks:</strong>
              </p>
              <ul style={{ margin: '4px 0 0', paddingLeft: 20 }}>
                <li>Health and provisioned seat counts</li>
                <li>Student landing page URLs (Students tab)</li>
                <li>Showroom column: full Soundcheck batch (status + deep-link)</li>
              </ul>
            </CardBody>
          </Card>
        </div>
      )}

      {qaResults.length > 0 ? (
        <QAResultsTable
          qaResults={filteredQAResults}
          title={qaTitle}
          page={page}
          setPage={setPage}
          perPage={perPage}
          setPerPage={setPerPage}
          sortBy={sortBy}
          setSortBy={setSortBy}
          sortDir={sortDir}
          setSortDir={setSortDir}
          groupByNamespace={groupByNamespace}
        />
      ) : (
        <EmptyState titleText="No QA results yet" headingLevel="h3" icon={SearchIcon}>
          <EmptyStateBody>
            {noSchedules
              ? 'Upload a schedule on Upload & Deploy, then pick your namespace and click Run QA.'
              : `Select a namespace (you have ${scheduleNamespaces.join(', ') || 'schedules loaded'}) and click Run QA.`}
          </EmptyStateBody>
        </EmptyState>
      )}

      <Divider style={{ margin: '24px 0' }} />
      <DestroyQASection showToast={showToast} />
    </PageSection>
  );
};
