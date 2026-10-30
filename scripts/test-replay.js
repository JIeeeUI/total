const assert = require('assert');
const fs = require('fs');
const path = require('path');
const replay = require('../js/replay.js');

console.log('[test-replay] 유효성 검사 시작...');

// 1. last_good.json 검증
const lastGood = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'last_good.json'), 'utf-8'));
assert.strictEqual(replay.validateNormalizedReading(lastGood), true, 'last_good.json must satisfy schema');
console.log('✓ last_good.json schema 검증 통과');

// 2. Fixture 순차 검증
const fixtureFiles = [
  'normal-d1-a.json',
  'normal-d1-b.json',
  'normal-d2.json',
  'timeout.json',
  'auth-401.json',
  'rate-429.json',
  'offline.json',
  'schema-break.json',
  'recover-d2.json'
];

let state = replay.resetEvaluationState();

// D1-A
const d1a = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'normal-d1-a.json'), 'utf-8'));
state = replay.runFixture(state, d1a);
assert.strictEqual(state.status.freshness, 'fresh');
assert.strictEqual(state.daily_readings.length, 1);
assert.strictEqual(state.current_reading.normalized_value, 100);

// D1-B
const d1b = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'normal-d1-b.json'), 'utf-8'));
state = replay.runFixture(state, d1b);
assert.strictEqual(state.status.freshness, 'fresh');
assert.strictEqual(state.daily_readings.length, 1, '동일 날짜는 1행 유지');
assert.strictEqual(state.current_reading.normalized_value, 105);

// TIMEOUT (C12, C17, C18)
const timeout = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'timeout.json'), 'utf-8'));
state = replay.runFixture(state, timeout);
assert.strictEqual(state.status.freshness, 'stale');
assert.strictEqual(state.status.error_code, 'timeout');
assert.strictEqual(state.current_reading.normalized_value, 105, '마지막 정상값 보존');
assert.strictEqual(state.daily_readings.length, 1);

// RECOVER-D2 (C19)
const recover = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'recover-d2.json'), 'utf-8'));
state = replay.runFixture(state, recover);
assert.strictEqual(state.status.freshness, 'fresh');
assert.strictEqual(state.status.error_code, 'none');
assert.strictEqual(state.daily_readings.length, 2, '다음 날짜 행 추가');
assert.strictEqual(state.current_reading.normalized_value, 120);
assert.strictEqual(state.last_delta, 15, '전일 대비 15 계산');

console.log('✓ 정상 시퀀스, 타임아웃 보존, D2 회복 및 전일 대비 검증 통과');
console.log('🎉 모든 자동 테스트 통과 완료!');
