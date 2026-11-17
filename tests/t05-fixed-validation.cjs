'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const adapter = require('../js/replay.js');
const fixture = name => JSON.parse(fs.readFileSync(path.join(__dirname, '../fixtures', name + '.json'), 'utf8'));
const original = fixture('normal-d1-a');
const baseline = () => adapter.runFixture(adapter.runFixture(adapter.resetEvaluationState(), original), fixture('normal-d1-b'));
function accepted(patch) {
  const reading = { ...original.payload, ...patch };
  assert.equal(adapter.validateNormalizedReading(reading), true);
  const state = adapter.runFixture(adapter.resetEvaluationState(), { ...original, payload: reading });
  assert.deepEqual(state.status, { freshness: 'fresh', error_code: 'none' });
  assert.equal(state.daily_readings.length, 1);
  assert.equal(state.current_reading.normalized_value, 100);
}
function rejected(patch) {
  const reading = { ...original.payload, ...patch };
  assert.throws(() => adapter.validateNormalizedReading(reading), TypeError);
  const before = baseline();
  const saved = structuredClone(before);
  const after = adapter.runFixture(before, { ...original, payload: reading });
  assert.deepEqual(after.status, { freshness: 'stale', error_code: 'schema_error' });
  assert.deepEqual(after.daily_readings, before.daily_readings);
  assert.deepEqual(after.current_reading, before.current_reading);
  assert.equal(after.current_reading.normalized_value, 105);
  assert.equal(after.daily_readings.length, 1);
  assert.deepEqual(before, saved);
}
const cases = [
  ['V01', () => {
    const before = baseline();
    assert.equal(before.current_reading.normalized_value, 105);
    assert.equal(before.daily_readings.length, 1);
    const first = adapter.runFixture(adapter.resetEvaluationState(), original);
    assert.equal(before.daily_readings[0].record_id, first.daily_readings[0].record_id);
    for (const [name, code] of [['timeout','timeout'], ['auth-401','auth'], ['rate-429','rate_limit'], ['offline','offline'], ['schema-break','schema_error']]) {
      const failed = adapter.runFixture(before, fixture(name));
      assert.deepEqual(failed.status, { freshness: 'stale', error_code: code });
      assert.deepEqual(failed.daily_readings, before.daily_readings);
      assert.deepEqual(failed.current_reading, before.current_reading);
      const recovered = adapter.runFixture(failed, fixture('recover-d2'));
      assert.deepEqual(recovered.status, { freshness: 'fresh', error_code: 'none' });
      assert.equal(recovered.daily_readings.length, 2);
      assert.equal(recovered.current_reading.normalized_value, 120);
      assert.deepEqual(recovered.last_comparison, { state: 'comparable', direction: 'increase', magnitude: 15, unit: 'pt' });
    }
  }],
  ['V02', () => accepted({ source_time: '2026-08-24T08:59:00.123+09:00', fetched_at: '2026-08-24T09:00:00.123+09:00' })],
  ['V03', () => accepted({ source_time: null })],
  ['V04', () => rejected({ source_time: 42 })],
  ['V05', () => rejected({ fetched_at: null, record_date: '1970-01-01' })],
  ['V06', () => rejected({ source_time: '2026-02-30T00:00:00Z' })],
  ['V07', () => rejected({ source_time: '2026-08-24T09:00:00' })],
  ['V08', () => { accepted({ source_name: 's'.repeat(120) }); rejected({ source_name: 's'.repeat(121) }); }],
  ['V09', () => { accepted({ unit: 'u'.repeat(24) }); rejected({ unit: 'u'.repeat(25) }); }],
  ['V10', () => rejected({ signal_id: 123 })]
];
const results = cases.map(([id, run]) => {
  try { run(); return { id, result: 'PASS' }; }
  catch (error) { return { id, result: 'FAIL', message: error.message }; }
});
const passed = results.filter(row => row.result === 'PASS').length;
console.log(JSON.stringify({
  executed_at: new Date().toISOString(),
  test_sha256: crypto.createHash('sha256').update(fs.readFileSync(__filename)).digest('hex'),
  total: cases.length, passed, failed: cases.length - passed, results
}, null, 2));
process.exitCode = passed === cases.length ? 0 : 1;

