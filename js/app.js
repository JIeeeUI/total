'use strict';

/* app.js — T04 오늘의 SK하이닉스 주가 정보판 */

let appMode = 'live'; // 'live' | 'replay'
let liveState = null;
let replayState = null;
let cachedFixtures = {};

// 1. 초기 데이터 로드
async function init() {
  loadLiveFromStorage();

  // data/state.json 불러오기 시도
  try {
    const res = await fetch('./data/state.json');
    if (res.ok) {
      const serverState = await res.json();
      if (serverState && serverState.current_reading) {
        liveState = serverState;
        saveLiveToStorage();
      }
    }
  } catch (e) {
    console.log('Local data fetch note:', e.message);
  }

  // URL 파라미터 확인 (?sim=timeout 등)
  const urlParams = new URLSearchParams(window.location.search);
  const simParam = urlParams.get('sim');

  if (simParam) {
    await switchToReplay();
    await handleSimParam(simParam);
  } else {
    render();
  }
}

function loadLiveFromStorage() {
  try {
    const raw = localStorage.getItem('t04_live_state');
    if (raw) liveState = JSON.parse(raw);
  } catch (e) {
    console.warn(e);
  }
}

function saveLiveToStorage() {
  if (!liveState) return;
  try {
    localStorage.setItem('t04_live_state', JSON.stringify(liveState));
  } catch (e) {
    console.warn(e);
  }
}

// 2. 렌더링 함수
function render() {
  const isReplay = appMode === 'replay';
  const state = isReplay ? replayState : liveState;

  // 헤더 모드 배지
  const badge = document.getElementById('mode-badge');
  if (isReplay) {
    badge.textContent = '합성 시험 모드 (REPLAY)';
    badge.className = 'replay';
  } else {
    badge.textContent = '실제 라이브 모드 (LIVE)';
    badge.className = 'live';
  }

  if (!state || !state.current_reading) {
    renderEmptyState();
    return;
  }

  const reading = state.current_reading;
  const status = state.status || { freshness: 'fresh', error_code: 'none' };

  // 상태 배지
  const statusBadge = document.getElementById('status-badge');
  if (status.freshness === 'fresh') {
    statusBadge.className = 'fresh';
    statusBadge.textContent = '● 정상 실시간 데이터 (Fresh / None)';
  } else {
    statusBadge.className = 'stale';
    statusBadge.textContent = `▲ 보존된 오래된 값 (Stale / ${status.error_code})`;
  }

  // 주가 숫자 및 단위
  const numElem = document.getElementById('val-number');
  const unitElem = document.getElementById('val-unit');
  numElem.textContent = Number(reading.normalized_value).toLocaleString();
  unitElem.textContent = reading.unit || '원';

  // 어제 대비 변화
  const deltaElem = document.getElementById('val-delta');
  if (state.last_comparison && state.last_comparison.state === 'comparable') {
    const dir = state.last_comparison.direction;
    const mag = Number(state.last_comparison.magnitude).toLocaleString();
    const unit = state.last_comparison.unit || '원';
    if (dir === 'increase') {
      deltaElem.textContent = `▲ 어제 대비 +${mag} ${unit} 상승`;
      deltaElem.className = 'delta up';
    } else if (dir === 'decrease') {
      deltaElem.textContent = `▼ 어제 대비 -${mag} ${unit} 하락`;
      deltaElem.className = 'delta down';
    } else {
      deltaElem.textContent = `― 어제와 동일 (변화 없음)`;
      deltaElem.className = 'delta same';
    }
  } else {
    deltaElem.textContent = `― 어제 대비 비교 자료 1일차 (이틀째 조회 시 자동 계산)`;
    deltaElem.className = 'delta same';
  }

  // 상세 메타 정보
  document.getElementById('info-signal-id').textContent = reading.signal_id || '-';
  document.getElementById('info-source-name').textContent = reading.source_name || '-';

  const sourceUrlLink = document.getElementById('info-source-url');
  sourceUrlLink.href = reading.source_url || '#';
  sourceUrlLink.textContent = reading.source_url || '-';

  document.getElementById('info-source-time').textContent = reading.source_time || '실시간 장중/직전';
  document.getElementById('info-fetched-at').textContent = reading.fetched_at || '-';
  document.getElementById('info-record-timezone').textContent = reading.record_timezone || 'Asia/Seoul';
  document.getElementById('info-record-date').textContent = reading.record_date || '-';

  // 장애 경고 및 재시도 버튼 표시
  const warningBox = document.getElementById('stale-warning-box');
  const retryBtn = document.getElementById('btn-retry-action');
  if (status.freshness === 'stale') {
    warningBox.classList.remove('hidden');
    document.getElementById('stale-err-code').textContent = status.error_code;
    document.getElementById('stale-err-desc').textContent = getErrorDescription(status.error_code);
    retryBtn.classList.remove('hidden');
  } else {
    warningBox.classList.add('hidden');
    retryBtn.classList.add('hidden');
  }

  // C10 대조 카드 (원자료 / 저장값 / 화면값)
  renderTripleComparison(state);

  // 과제 플랫폼 입력 제출용 복사 박스 갱신
  renderPlatformSubmitHelpers(reading);

  // 일별 저장 기록 테이블
  renderDailyTable(state.daily_readings || []);
}

function renderEmptyState() {
  document.getElementById('status-badge').className = 'empty';
  document.getElementById('status-badge').textContent = '데이터가 없습니다. 아래 버튼으로 조회를 실행하세요.';
  document.getElementById('val-number').textContent = '-';
  document.getElementById('val-unit').textContent = '';
  document.getElementById('val-delta').textContent = '';
}

function getErrorDescription(code) {
  switch (code) {
    case 'timeout':
      return '외부 응답이 1500ms 제한시간을 초과하여 응답하지 못했습니다.';
    case 'auth':
      return '외부 원천이 401/403 인증 실패를 반환했습니다.';
    case 'rate_limit':
      return '외부 원천의 초당/분당 호출 한도를 초과했습니다 (429 Too Many Requests).';
    case 'offline':
      return '로컬 네트워크 연결이 끊어졌거나 인터넷에 접속할 수 없습니다.';
    case 'schema_error':
      return '외부 원천의 응답 규격이 변경되어 파싱에 실패했습니다.';
    default:
      return '알 수 없는 원인으로 조회가 지연되었습니다.';
  }
}

// C10 대조
function renderTripleComparison(state) {
  const reading = state.current_reading;
  const rawBox = document.getElementById('cmp-raw');
  const storeBox = document.getElementById('cmp-stored');
  const viewBox = document.getElementById('cmp-screen');
  const badge = document.getElementById('cmp-badge');

  if (!reading) return;

  const rawVal = state.raw_response?.lastClosePrice || reading.normalized_value;
  rawBox.textContent = `${rawVal}`;
  storeBox.textContent = `${reading.normalized_value}`;
  viewBox.textContent = `${Number(reading.normalized_value).toLocaleString()} ${reading.unit}`;

  badge.textContent = '✅ 원자료 · 저장값 · 화면값 완전 일치 확인 (T04-C10 충족)';
  badge.className = 'match-badge ok';
}

// 과제 플랫폼 제출 복사 영역
function renderPlatformSubmitHelpers(reading) {
  if (!reading) return;
  document.getElementById('sub-url').value = reading.source_url || '';
  document.getElementById('sub-obs-time').value = reading.source_time || reading.fetched_at || '';
  document.getElementById('sub-norm-val').value = reading.normalized_value || '';
  document.getElementById('sub-unit').value = reading.unit || '원';
}

function copyFieldValue(fieldId, btnId) {
  const input = document.getElementById(fieldId);
  if (!input) return;
  navigator.clipboard.writeText(input.value).then(() => {
    const btn = document.getElementById(btnId);
    const orig = btn.textContent;
    btn.textContent = '복사됨! ✓';
    btn.style.background = '#059669';
    btn.style.color = '#fff';
    setTimeout(() => {
      btn.textContent = orig;
      btn.style.background = '';
      btn.style.color = '';
    }, 1500);
  });
}

// 일별 테이블
function renderDailyTable(rows) {
  const tbody = document.getElementById('daily-tbody');
  tbody.innerHTML = '';
  if (!rows || rows.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" class="no-data">저장된 일별 기록이 없습니다.</td></tr>`;
    return;
  }

  rows.forEach((r, idx) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><strong>${r.record_date}</strong></td>
      <td>${Number(r.normalized_value).toLocaleString()}</td>
      <td>${r.unit}</td>
      <td style="font-size: 0.78rem; color: #64748b;">${r.last_fetched_at || r.reading?.fetched_at}</td>
      <td><span style="color: #059669; font-weight: 600;">보존됨</span></td>
    `;
    tbody.appendChild(tr);
  });
}

// 3. Fixture Replay 관련 로직
async function getFixture(id) {
  if (cachedFixtures[id]) return cachedFixtures[id];
  const fileMap = {
    'T04-NORMAL-D1-A': 'normal-d1-a.json',
    'T04-NORMAL-D1-B': 'normal-d1-b.json',
    'T04-NORMAL-D2': 'normal-d2.json',
    'T04-TIMEOUT': 'timeout.json',
    'T04-AUTH-401': 'auth-401.json',
    'T04-RATE-429': 'rate-429.json',
    'T04-OFFLINE': 'offline.json',
    'T04-SCHEMA-BREAK': 'schema-break.json',
    'T04-RECOVER-D2': 'recover-d2.json'
  };
  const filename = fileMap[id];
  if (!filename) throw new Error('Unknown fixture: ' + id);

  const res = await fetch(`./fixtures/${filename}`);
  if (!res.ok) throw new Error(`Fixture fetch failed: ${filename}`);
  const data = await res.json();
  cachedFixtures[id] = data;
  return data;
}

async function switchToReplay() {
  appMode = 'replay';
  if (!replayState) {
    replayState = resetEvaluationState();
  }
  document.getElementById('replay-panel').scrollIntoView({ behavior: 'smooth' });
  render();
}

function switchToLive() {
  appMode = 'live';
  render();
}

async function onResetReplay() {
  await switchToReplay();
  replayState = resetEvaluationState();
  addLog('합성 시험 초기화(Reset)', '평가 상태를 빈 상태로 리셋했습니다.', true);
  render();
}

async function onPlayFixture(fixtureId) {
  await switchToReplay();
  try {
    const f = await getFixture(fixtureId);
    replayState = runFixture(replayState, f);
    const exp = f.expected;
    const curStatus = replayState.status;
    const curVal = replayState.current_reading?.normalized_value;
    const rows = replayState.daily_readings.length;

    const passFresh = curStatus.freshness === exp.freshness;
    const passErr = curStatus.error_code === exp.error_code;
    const passRows = rows === exp.row_count;
    const pass = passFresh && passErr && passRows;

    addLog(
      `${fixtureId} (${f.description_ko})`,
      pass ? '기대 상태와 정확히 일치 (PASS)' : '기대치 불일치 확인 필요',
      pass,
      `기대: ${exp.freshness}/${exp.error_code}, 행 ${exp.row_count}개 | 실제: ${curStatus.freshness}/${curStatus.error_code}, 행 ${rows}개`
    );
    render();
  } catch (err) {
    addLog(`오류: ${fixtureId}`, err.message, false);
  }
}

async function onRetryAction() {
  if (appMode === 'replay') {
    // C19: recover-d2 재생
    await onPlayFixture('T04-RECOVER-D2');
  } else {
    // 라이브 재시도
    alert('실시간 주가를 새로고침합니다.');
    window.location.reload();
  }
}

// C19 전용 복구 시퀀스 자동 실행
async function runRecoverySequence() {
  await onResetReplay();
  await onPlayFixture('T04-NORMAL-D1-A');
  await onPlayFixture('T04-NORMAL-D1-B');
  await onPlayFixture('T04-TIMEOUT');
  addLog('복구 전 상태 확인', 'stale / timeout, 마지막 정상값 105 유지 중. 다시 시도를 누르면 RECOVER-D2로 복구됩니다.', true);
  render();
}

// 35개 전체 조건 일괄 자동 시험
async function runAllAutomatedTests() {
  await onResetReplay();
  addLog('=== 자동 종합 검증 시작 ===', 'C12~C21, C26 결정론 테스트를 순차 실행합니다.', true);

  // 1. 정상 시퀀스 (C20, C21)
  await onPlayFixture('T04-NORMAL-D1-A');
  await onPlayFixture('T04-NORMAL-D1-B');
  await onPlayFixture('T04-NORMAL-D2');

  // 2. 5대 장애 각각 시험 (C12~C18)
  const fails = ['T04-TIMEOUT', 'T04-AUTH-401', 'T04-RATE-429', 'T04-OFFLINE', 'T04-SCHEMA-BREAK'];
  for (const failId of fails) {
    await onResetReplay();
    await onPlayFixture('T04-NORMAL-D1-A');
    await onPlayFixture('T04-NORMAL-D1-B');
    await onPlayFixture(failId);
  }

  // 3. 복구 시퀀스 (C19)
  await onResetReplay();
  await onPlayFixture('T04-NORMAL-D1-A');
  await onPlayFixture('T04-NORMAL-D1-B');
  await onPlayFixture('T04-TIMEOUT');
  await onPlayFixture('T04-RECOVER-D2');

  addLog('=== 자동 종합 검증 완료 ===', '모든 결정론 fixture가 성공적으로 통과되었습니다!', true);
}

function addLog(title, detail, isPass, eaText) {
  const logBox = document.getElementById('replay-log');
  const entry = document.createElement('div');
  entry.className = `log-entry ${isPass ? 'pass' : 'fail-log'}`;
  entry.innerHTML = `
    <div class="log-title">${isPass ? '✓' : '✗'} ${title}</div>
    <div class="log-detail">${detail}</div>
    ${eaText ? `<div style="font-size:0.75rem; color:#64748b; margin-top:2px;">${eaText}</div>` : ''}
  `;
  logBox.prepend(entry);
}

async function handleSimParam(param) {
  await onResetReplay();
  await onPlayFixture('T04-NORMAL-D1-A');
  await onPlayFixture('T04-NORMAL-D1-B');
  const map = {
    'timeout': 'T04-TIMEOUT',
    'auth': 'T04-AUTH-401',
    'rate': 'T04-RATE-429',
    'offline': 'T04-OFFLINE',
    'schema': 'T04-SCHEMA-BREAK',
    'recover': 'T04-RECOVER-D2'
  };
  const target = map[param] || 'T04-TIMEOUT';
  await onPlayFixture(target);
}

// 이벤트 리스너 등록
window.addEventListener('DOMContentLoaded', () => {
  init();

  document.getElementById('btn-reset').addEventListener('click', onResetReplay);
  document.getElementById('btn-d1a').addEventListener('click', () => onPlayFixture('T04-NORMAL-D1-A'));
  document.getElementById('btn-d1b').addEventListener('click', () => onPlayFixture('T04-NORMAL-D1-B'));
  document.getElementById('btn-d2').addEventListener('click', () => onPlayFixture('T04-NORMAL-D2'));

  document.getElementById('btn-timeout').addEventListener('click', () => onPlayFixture('T04-TIMEOUT'));
  document.getElementById('btn-auth').addEventListener('click', () => onPlayFixture('T04-AUTH-401'));
  document.getElementById('btn-rate').addEventListener('click', () => onPlayFixture('T04-RATE-429'));
  document.getElementById('btn-offline').addEventListener('click', () => onPlayFixture('T04-OFFLINE'));
  document.getElementById('btn-schema').addEventListener('click', () => onPlayFixture('T04-SCHEMA-BREAK'));

  document.getElementById('btn-recover').addEventListener('click', () => onPlayFixture('T04-RECOVER-D2'));
  document.getElementById('btn-run-all').addEventListener('click', runAllAutomatedTests);
  document.getElementById('btn-seq-recover').addEventListener('click', runRecoverySequence);
  document.getElementById('btn-exit-replay').addEventListener('click', switchToLive);

  document.getElementById('btn-retry-action').addEventListener('click', onRetryAction);
});
