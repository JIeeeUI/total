/* replay.js ── fixture 재생 엔진
   adapter-reset.example.js 의 상태 전이를 브라우저에서 동일하게 재현합니다. */

'use strict';

/* ── 상수 ── */
const NORMALIZED_KEYS = Object.freeze([
  'signal_id','normalized_value','unit','source_name',
  'source_url','source_time','fetched_at','record_timezone','record_date'
]);

const ERROR_CODES = Object.freeze([
  'timeout','auth','rate_limit','offline','schema_error'
]);

/* ── 유틸 ── */
function clone(v) { return JSON.parse(JSON.stringify(v)); }

function kstDate(isoString) {
  const d = new Date(isoString);
  if (Number.isNaN(d.getTime())) throw new TypeError('invalid date-time');
  const parts = new Intl.DateTimeFormat('en', {
    timeZone:'Asia/Seoul', year:'numeric', month:'2-digit', day:'2-digit'
  }).formatToParts(d);
  const m = Object.fromEntries(parts.map(p => [p.type, p.value]));
  return `${m.year}-${m.month}-${m.day}`;
}

/* ── 검증 ── */
function validateNormalizedReading(r) {
  if (!r || typeof r !== 'object' || Array.isArray(r))
    throw new TypeError('normalized reading must be an object');
  const actual = Object.keys(r).sort();
  const expected = [...NORMALIZED_KEYS].sort();
  if (actual.length !== expected.length || actual.some((k,i) => k !== expected[i]))
    throw new TypeError('keys mismatch');
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(r.signal_id) || r.signal_id.length > 100)
    throw new TypeError('signal_id invalid');
  if (typeof r.normalized_value !== 'number' || !Number.isFinite(r.normalized_value))
    throw new TypeError('normalized_value must be finite number');
  for (const f of ['unit','source_name'])
    if (typeof r[f] !== 'string' || r[f].trim() === '') throw new TypeError(f+' empty');
  let u;
  try { u = new URL(r.source_url); } catch { throw new TypeError('source_url invalid'); }
  if (u.protocol !== 'https:') throw new TypeError('source_url must be https');
  if (r.source_time !== null && Number.isNaN(new Date(r.source_time).getTime()))
    throw new TypeError('source_time invalid');
  if (Number.isNaN(new Date(r.fetched_at).getTime()))
    throw new TypeError('fetched_at invalid');
  if (r.record_timezone !== 'Asia/Seoul')
    throw new TypeError('record_timezone must be Asia/Seoul');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(r.record_date) || r.record_date !== kstDate(r.fetched_at))
    throw new TypeError('record_date mismatch');
  return true;
}

function validateStatus(s) {
  if (!s || typeof s !== 'object' || Array.isArray(s)) return false;
  if (s.freshness === 'fresh') return s.error_code === 'none';
  if (s.freshness === 'stale')  return ERROR_CODES.includes(s.error_code);
  return false;
}

/* ── 초기 상태 ── */
function resetEvaluationState() {
  return {
    schema_version: 'aleph-t04-evaluation-state-v1',
    daily_readings: [],
    current_reading: null,
    status: null,
    last_delta: null,
    last_comparison: { state:'insufficient', direction:null, magnitude:null, unit:null },
    last_run: null,
    sequence: 0
  };
}

/* ── 레코드 ID ── */
function recordIdFor(r) { return `demo-${r.signal_id}-${r.record_date}`; }

/* ── 전일 대비 ── */
function comparisonFor(rows, current) {
  const prev = rows
    .filter(r => r.signal_id === current.signal_id && r.record_date < current.record_date)
    .sort((a,b) => b.record_date.localeCompare(a.record_date))[0];
  if (!prev) return { state:'insufficient', direction:null, magnitude:null, unit:null };
  if (prev.unit !== current.unit) return { state:'unit_mismatch', direction:null, magnitude:null, unit:null };
  const signed = current.normalized_value - prev.normalized_value;
  return {
    state: 'comparable',
    direction: signed > 0 ? 'increase' : signed < 0 ? 'decrease' : 'unchanged',
    magnitude: Math.abs(signed),
    unit: current.unit
  };
}

/* ── 정상 적용 ── */
function applySuccessfulReading(inputState, reading, runMeta) {
  runMeta = runMeta || {};
  validateNormalizedReading(reading);
  const st = clone(inputState);
  const idx = st.daily_readings.findIndex(
    r => r.signal_id === reading.signal_id && r.record_date === reading.record_date
  );
  const existing = idx >= 0 ? st.daily_readings[idx] : null;
  const row = {
    record_id: existing ? existing.record_id : recordIdFor(reading),
    signal_id: reading.signal_id,
    record_date: reading.record_date,
    normalized_value: reading.normalized_value,
    unit: reading.unit,
    first_fetched_at: existing ? existing.first_fetched_at : reading.fetched_at,
    last_fetched_at: reading.fetched_at,
    reading: clone(reading)
  };
  if (idx >= 0) st.daily_readings[idx] = row;
  else st.daily_readings.push(row);
  st.daily_readings.sort((a,b) => a.record_date.localeCompare(b.record_date));
  st.current_reading = clone(reading);
  st.status = { freshness:'fresh', error_code:'none' };
  st.last_comparison = comparisonFor(st.daily_readings, row);
  st.last_delta = st.last_comparison.magnitude;
  st.sequence += 1;
  st.last_run = {
    fixture_id: runMeta.fixture_id || null,
    virtual_now: runMeta.virtual_now || reading.fetched_at,
    outcome: 'success',
    error_code: 'none',
    retry_after_seconds: null
  };
  return st;
}

/* ── 오류 적용 ── */
function applyError(inputState, errorCode, runMeta) {
  runMeta = runMeta || {};
  if (!ERROR_CODES.includes(errorCode)) throw new TypeError('bad error_code: '+errorCode);
  const st = clone(inputState);
  st.status = { freshness:'stale', error_code: errorCode };
  st.sequence += 1;
  st.last_run = {
    fixture_id: runMeta.fixture_id || null,
    virtual_now: runMeta.virtual_now || null,
    outcome: 'error',
    error_code: errorCode,
    retry_after_seconds: runMeta.retry_after_seconds ?? null
  };
  return st;
}

/* ── fixture 실행 ── */
function runFixture(inputState, fixture) {
  const meta = {
    fixture_id: fixture.fixture_id,
    virtual_now: fixture.virtual_now,
    retry_after_seconds: fixture.transport.headers['retry-after']
      ? Number(fixture.transport.headers['retry-after']) : null
  };
  if (fixture.transport.mode === 'timeout')  return applyError(inputState, 'timeout', meta);
  if (fixture.transport.mode === 'offline')  return applyError(inputState, 'offline', meta);
  if (fixture.transport.status === 401 || fixture.transport.status === 403)
    return applyError(inputState, 'auth', meta);
  if (fixture.transport.status === 429) return applyError(inputState, 'rate_limit', meta);
  if (fixture.transport.status >= 200 && fixture.transport.status < 300) {
    try { return applySuccessfulReading(inputState, fixture.payload, meta); }
    catch { return applyError(inputState, 'schema_error', meta); }
  }
  return applyError(inputState, 'schema_error', meta);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    NORMALIZED_KEYS,
    ERROR_CODES,
    validateNormalizedReading,
    validateStatus,
    resetEvaluationState,
    recordIdFor,
    comparisonFor,
    applySuccessfulReading,
    applyError,
    runFixture,
    kstDate
  };
}
