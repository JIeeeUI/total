'use strict';

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function getKstDateParts(dateObj) {
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).formatToParts(dateObj);
  return Object.fromEntries(parts.map(p => [p.type, p.value]));
}

function getKstDateString(dateObj) {
  const p = getKstDateParts(dateObj);
  return `${p.year}-${p.month}-${p.day}`;
}

function getKstIsoString(dateObj) {
  const p = getKstDateParts(dateObj);
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}+09:00`;
}

async function fetchFromNaver() {
  const url = 'https://m.stock.naver.com/api/stock/000660/integration';
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    }
  });
  if (!res.ok) {
    throw new Error(`Naver fetch failed: HTTP ${res.status}`);
  }
  const data = await res.json();
  
  // 가격 추출
  let priceStr = null;
  const lastCloseInfo = data.totalInfos?.find(i => i.code === 'lastClosePrice');
  if (lastCloseInfo && lastCloseInfo.value) {
    priceStr = lastCloseInfo.value;
  } else if (data.dealTrendInfos && data.dealTrendInfos[0] && data.dealTrendInfos[0].closePrice) {
    priceStr = data.dealTrendInfos[0].closePrice;
  }

  if (!priceStr) {
    throw new Error('Price field not found in response');
  }

  const numericPrice = Number(String(priceStr).replace(/,/g, '').trim());
  if (!Number.isFinite(numericPrice)) {
    throw new Error(`Invalid numeric price: ${priceStr}`);
  }

  // 거래일 / 관측 시각
  let obsTime = null;
  const latestBiz = data.dealTrendInfos?.[0]?.bizdate; // e.g. "20261029"
  if (latestBiz && latestBiz.length === 8) {
    const y = latestBiz.slice(0, 4);
    const m = latestBiz.slice(4, 6);
    const d = latestBiz.slice(6, 8);
    obsTime = `${y}-${m}-${d}T15:30:00+09:00`;
  } else {
    obsTime = getKstIsoString(new Date());
  }

  return {
    numericPrice,
    obsTime,
    sourceUrl: url,
    sourceName: '한국거래소 KRX / 네이버페이 증권',
    rawPayload: {
      stockName: data.stockName || 'SK하이닉스',
      itemCode: data.itemCode || '000660',
      lastClosePrice: priceStr,
      latestBizdate: latestBiz || null
    }
  };
}

async function fetchFromYahoo() {
  const url = 'https://query1.finance.yahoo.com/v8/finance/chart/000660.KS?interval=1d';
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0' }
  });
  if (!res.ok) throw new Error(`Yahoo fetch failed: HTTP ${res.status}`);
  const data = await res.json();
  const meta = data.chart?.result?.[0]?.meta;
  if (!meta || !meta.regularMarketPrice) throw new Error('Yahoo market price missing');
  
  const numericPrice = Math.round(Number(meta.regularMarketPrice));
  const obsTime = meta.regularMarketTime
    ? new Date(meta.regularMarketTime * 1000).toISOString()
    : getKstIsoString(new Date());

  return {
    numericPrice,
    obsTime,
    sourceUrl: url,
    sourceName: '한국거래소 KRX / Yahoo Finance',
    rawPayload: {
      symbol: meta.symbol,
      regularMarketPrice: numericPrice,
      regularMarketTime: meta.regularMarketTime
    }
  };
}

async function main() {
  console.log('[fetch-price] SK하이닉스 주가 수집 시작...');
  const now = new Date();
  const fetchedAtIso = now.toISOString();
  const recordDate = getKstDateString(now);

  let fetchedData;
  try {
    fetchedData = await fetchFromNaver();
  } catch (err) {
    console.warn('[fetch-price] Naver 조회 실패, Yahoo로 재시도:', err.message);
    try {
      fetchedData = await fetchFromYahoo();
    } catch (err2) {
      console.error('[fetch-price] 모든 출처 조회 실패:', err2.message);
      process.exit(1);
    }
  }

  const reading = {
    signal_id: 'sk-hynix-close-price',
    normalized_value: fetchedData.numericPrice,
    unit: '원',
    source_name: fetchedData.sourceName,
    source_url: fetchedData.sourceUrl,
    source_time: fetchedData.obsTime,
    fetched_at: fetchedAtIso,
    record_timezone: 'Asia/Seoul',
    record_date: recordDate
  };

  console.log('[fetch-price] 수집 완료:', JSON.stringify(reading, null, 2));

  // 1. data/YYYY-MM-DD.json 저장
  const dailyFile = path.join(DATA_DIR, `${recordDate}.json`);
  fs.writeFileSync(dailyFile, JSON.stringify(reading, null, 2), 'utf-8');

  // 2. data/last_good.json 저장
  const lastGoodFile = path.join(DATA_DIR, 'last_good.json');
  fs.writeFileSync(lastGoodFile, JSON.stringify(reading, null, 2), 'utf-8');

  // 3. state.json 업데이트 (전체 누적 기록 및 상태)
  const stateFile = path.join(DATA_DIR, 'state.json');
  let state = {
    schema_version: 'aleph-t04-evaluation-state-v1',
    daily_readings: [],
    current_reading: null,
    status: { freshness: 'fresh', error_code: 'none' },
    last_delta: null,
    last_comparison: { state: 'insufficient', direction: null, magnitude: null, unit: null },
    raw_response: fetchedData.rawPayload
  };

  if (fs.existsSync(stateFile)) {
    try {
      state = JSON.parse(fs.readFileSync(stateFile, 'utf-8'));
    } catch {
      // ignore
    }
  }

  // 일별 기록에 추가/갱신 (signal_id + record_date 동일 시 갱신)
  const existingIdx = state.daily_readings.findIndex(
    r => r.signal_id === reading.signal_id && r.record_date === reading.record_date
  );
  const row = {
    record_id: `live-${reading.signal_id}-${reading.record_date}`,
    signal_id: reading.signal_id,
    record_date: reading.record_date,
    normalized_value: reading.normalized_value,
    unit: reading.unit,
    first_fetched_at: existingIdx >= 0 ? state.daily_readings[existingIdx].first_fetched_at : reading.fetched_at,
    last_fetched_at: reading.fetched_at,
    reading
  };

  if (existingIdx >= 0) {
    state.daily_readings[existingIdx] = row;
  } else {
    state.daily_readings.push(row);
  }
  state.daily_readings.sort((a, b) => a.record_date.localeCompare(b.record_date));

  // 전일 대비 계산
  const prevRows = state.daily_readings.filter(
    r => r.signal_id === reading.signal_id && r.record_date < reading.record_date
  );
  if (prevRows.length > 0) {
    const prev = prevRows[prevRows.length - 1];
    const diff = reading.normalized_value - prev.normalized_value;
    state.last_comparison = {
      state: 'comparable',
      direction: diff > 0 ? 'increase' : diff < 0 ? 'decrease' : 'unchanged',
      magnitude: Math.abs(diff),
      unit: reading.unit,
      previous_value: prev.normalized_value,
      diff
    };
    state.last_delta = Math.abs(diff);
  } else {
    state.last_comparison = { state: 'insufficient', direction: null, magnitude: null, unit: null };
    state.last_delta = null;
  }

  state.current_reading = reading;
  state.status = { freshness: 'fresh', error_code: 'none' };
  state.raw_response = fetchedData.rawPayload;

  fs.writeFileSync(stateFile, JSON.stringify(state, null, 2), 'utf-8');
  console.log('[fetch-price] state.json 업데이트 성공!');
}

main().catch(err => {
  console.error('[fetch-price] 실행 에러:', err);
  process.exit(1);
});
