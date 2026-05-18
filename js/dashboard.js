// ===================================================================
// Stage 6: KPI 계산 + 우측 패널 시각화 (텍스트 + Chart.js)
//
// - Stage 5의 텍스트 KPI는 그대로 유지하면서 카드 우측에 미니 도넛 게이지를 부착하고,
//   상단에는 메인 반원 게이지, 그 아래에 5분 트렌드 라인 차트를 함께 갱신한다.
// - 차트 인스턴스 자체는 charts.js가 관리. 이 파일은 KPI 값을 만들어 넘기는 역할만.
// - 일시정지 중에도 마지막 KPI를 유지한다 (realDelta 기반 throttle을 쓰되,
//   값은 Station.stats를 그대로 읽으므로 simulation이 멈춰 있으면 자연스럽게 동결).
//
// 공식 정리:
//   시간가동률 = operatingTime / (operatingTime + downTime)
//   성능가동률 = (cycleTime × producedCount) / operatingTime,  ≤ 1.0
//   양품률    = goodCount / producedCount
//   OEE       = 시간가동률 × 성능가동률 × 양품률
//
//   라인 전체 OEE = supply·shipping 제외 station들의 OEE 산술 평균
// ===================================================================

import {
  initMiniGauge,
  updateMiniGauge,
  updateOverallGauge,
  recordTrendSample,
} from './charts.js';

// ---------- 표시 정보 매핑 ----------
const STATION_DISPLAY_NAMES = {
  'injection-1': '사출기 #1 (렌즈)',
  'injection-2': '사출기 #2 (베젤)',
  'injection-3': '사출기 #3 (하우징)',
  'surface':     '표면처리',
  'assembly':    '조립 라인',
  'shipping':    '출하장',
  'supply':      '전자부품 공급',
};

// 상태 배지: label은 화면 텍스트, class는 CSS 변형 클래스 suffix (--processing 등).
const STATUS_DISPLAY = {
  'idle':       { label: '대기', class: 'idle' },
  'processing': { label: '가동', class: 'processing' },
  'blocked':    { label: '정체', class: 'blocked' },
  'starved':    { label: '기아', class: 'starved' },
};

// 라인 전체 OEE 산정 시 제외할 station id.
// - supply: 외부 공급 모델로 가동률이 사실상 100% 고정. 평균을 왜곡함.
// - shipping: 출하 카운트 용도. 사이클타임 5초로 OEE 의미가 약함.
const EXCLUDE_FROM_LINE_OEE = ['shipping', 'supply'];

// 카드 노출 순서 (라인 흐름 순; supply·shipping은 마지막).
const CARD_ORDER = [
  'injection-1', 'injection-2', 'injection-3',
  'surface', 'assembly', 'shipping', 'supply',
];

// 화면 업데이트 throttle. 매 프레임 DOM·차트를 만지면 성능·가독성 모두 손해.
const UPDATE_INTERVAL = 0.5;   // 초 (실시간 기준)
let _accumulator = 0;          // realDelta 누적 (호출 사이에 유지)

/**
 * 단일 Station의 KPI 4종 계산. 분모 0 케이스는 안전한 fallback 으로 NaN 방지.
 * @param {import('./simulation.js').Station} station
 * @returns {{availability: number, performance: number, quality: number, oee: number}}
 */
export function calculateKPIs(station) {
  const { operatingTime, downTime, producedCount, goodCount } = station.stats;

  const denom = operatingTime + downTime;
  const availability = denom > 0 ? operatingTime / denom : 1.0;

  const performance = operatingTime > 0
    ? Math.min(1.0, (station.cycleTime * producedCount) / operatingTime)
    : 0;

  const quality = producedCount > 0 ? goodCount / producedCount : 1.0;

  const oee = availability * performance * quality;
  return { availability, performance, quality, oee };
}

/**
 * 매 프레임 main.js에서 호출. 내부적으로 0.5초마다 DOM·차트를 갱신한다.
 *
 * @param {Map<string, import('./simulation.js').Station>} stations
 * @param {number} realDelta - 실제 시간 경과(초). simState.timeScale 영향 안 받음.
 * @param {number} simulationTime - 시뮬레이션 누적 시간(초). 트렌드 샘플의 x축 라벨용.
 */
export function updateDashboard(stations, realDelta, simulationTime = 0) {
  _accumulator += realDelta;
  if (_accumulator < UPDATE_INTERVAL) return;
  _accumulator = 0;

  const lineOEE = _computeLineOEE(stations);
  _renderOverall(lineOEE);
  _renderCards(stations);

  // 트렌드 차트 — 시뮬레이션 시간 기준으로 샘플링 (일시정지 중엔 자연스럽게 멈춤)
  recordTrendSample(simulationTime, lineOEE);
}

/** supply·shipping 제외 station들의 OEE 산술 평균. 활성 station이 없으면 0. */
function _computeLineOEE(stations) {
  let sum = 0;
  let count = 0;
  for (const station of stations.values()) {
    if (EXCLUDE_FROM_LINE_OEE.includes(station.id)) continue;
    sum += calculateKPIs(station).oee;
    count += 1;
  }
  return count > 0 ? sum / count : 0;
}

/** 메인 게이지·중앙 텍스트 갱신. */
function _renderOverall(lineOEE) {
  const overallEl = document.getElementById('overall-oee');
  if (overallEl) overallEl.textContent = `${(lineOEE * 100).toFixed(1)}%`;
  updateOverallGauge(lineOEE);
}

/**
 * 각 station 카드 렌더링.
 * - 컨테이너에 카드가 없으면 CARD_ORDER 순서로 만들고 미니 게이지를 부착
 * - 이후엔 같은 DOM 노드를 재사용해서 textContent + 게이지 데이터만 바꿈
 */
function _renderCards(stations) {
  const container = document.getElementById('station-kpis');
  if (!container) return;

  for (const id of CARD_ORDER) {
    const station = stations.get(id);
    if (!station) continue;     // STATION_SPECS에 없는 id는 스킵 (안전망)

    let card = container.querySelector(`[data-station-id="${id}"]`);
    if (!card) {
      card = _createStationCard(id);
      container.appendChild(card);
      // 카드 DOM이 트리에 들어간 직후 mini gauge 인스턴스를 부착.
      // (Chart.js는 canvas의 부모 크기를 측정하므로 DOM 부착 후가 안전)
      const canvasEl = card.querySelector('canvas[data-mini-gauge]');
      if (canvasEl) initMiniGauge(id, canvasEl);
    }
    _updateStationCard(card, station);
  }
}

/**
 * 카드 DOM 한 번만 생성. 이후엔 update만 호출.
 * innerHTML은 정적 한글 텍스트 + 상수 id만 들어가므로 안전.
 *
 * 레이아웃: 좌측 = 이름·텍스트 지표 4종 / 우측 = 미니 게이지(가운데 OEE %) + 상태 배지
 */
function _createStationCard(id) {
  const card = document.createElement('div');
  card.className = 'kpi-card';
  card.dataset.stationId = id;
  const name = STATION_DISPLAY_NAMES[id] || id;
  card.innerHTML = `
    <div class="kpi-card__main">
      <div class="kpi-card__name">${name}</div>
      <dl class="kpi-card__metrics">
        <dt>시간가동률</dt><dd data-metric="availability">—</dd>
        <dt>성능가동률</dt><dd data-metric="performance">—</dd>
        <dt>양품률</dt><dd data-metric="quality">—</dd>
        <dt>누적 생산</dt><dd data-metric="produced">0개</dd>
      </dl>
    </div>
    <div class="kpi-card__side">
      <div class="kpi-card__gauge-wrap">
        <canvas data-mini-gauge></canvas>
        <span class="kpi-card__oee-text" data-metric="oee">—</span>
      </div>
      <span class="kpi-card__status">—</span>
    </div>
  `;
  return card;
}

/** 기존 카드의 텍스트·상태 배지·미니 게이지를 갱신. */
function _updateStationCard(card, station) {
  const kpis = calculateKPIs(station);
  const statusInfo = STATUS_DISPLAY[station.status] || { label: '—', class: 'idle' };

  // 상태 배지: 클래스 변형으로 색상 교체. (--processing/--blocked/--starved/--idle)
  const statusEl = card.querySelector('.kpi-card__status');
  statusEl.textContent = statusInfo.label;
  statusEl.className = `kpi-card__status kpi-card__status--${statusInfo.class}`;

  // 좌측 텍스트 지표 4종
  card.querySelector('[data-metric="availability"]').textContent =
    `${(kpis.availability * 100).toFixed(1)}%`;
  card.querySelector('[data-metric="performance"]').textContent =
    `${(kpis.performance * 100).toFixed(1)}%`;
  card.querySelector('[data-metric="quality"]').textContent =
    `${(kpis.quality * 100).toFixed(1)}%`;
  card.querySelector('[data-metric="produced"]').textContent =
    `${station.stats.producedCount}개`;

  // 우측 미니 게이지 + 가운데 OEE 텍스트
  card.querySelector('[data-metric="oee"]').textContent =
    `${(kpis.oee * 100).toFixed(0)}%`;
  updateMiniGauge(station.id, kpis.oee);
}

/**
 * 리셋 직후 한 프레임 안에 KPI 표시가 0으로 동기화되도록 throttle을 강제 만료.
 * main.js의 리셋 핸들러에서 호출.
 */
export function resetDashboardThrottle() {
  _accumulator = UPDATE_INTERVAL;
}
