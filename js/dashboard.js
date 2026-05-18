// ===================================================================
// Stage 5: KPI 계산 + 우측 패널 텍스트 표시
//
// - Station.stats(=Stage 4에서 누적된 원천 데이터)를 JIPM 한국식 OEE 공식으로
//   가공해 우측 패널에 실시간 표시한다.
// - 시각화(게이지·차트)는 Stage 6의 몫. 이번 단계는 텍스트 기반.
// - 일시정지 중에도 마지막 KPI를 유지한다 (realDelta 기반 throttle을 쓰되,
//   값 자체는 Station.stats를 그대로 읽으므로 simulation이 멈춰 있으면 값이
//   변하지 않고 자연스럽게 동결된다).
//
// 공식 정리:
//   시간가동률 = operatingTime / (operatingTime + downTime)
//   성능가동률 = (cycleTime × producedCount) / operatingTime,  ≤ 1.0
//   양품률    = goodCount / producedCount
//   OEE       = 시간가동률 × 성능가동률 × 양품률
//
//   라인 전체 OEE = supply·shipping 제외 station들의 OEE 산술 평균
//   (시연 단순성 우선; 가중 평균은 추후 단계에서 도입)
// ===================================================================

// ---------- 표시 정보 매핑 ----------
// 한글 라벨은 config의 EQUIPMENT.name과 의도적으로 약간 다르게 둠
// (대시보드는 한 줄 텍스트로 압축; 3D 라벨은 두 줄 가독성 우선).
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

// 화면 업데이트 throttle. 매 프레임 DOM을 만지면 성능·가독성 모두 손해.
const UPDATE_INTERVAL = 0.5;   // 초
let _accumulator = 0;          // realDelta 누적 (호출 사이에 유지)

/**
 * 단일 Station의 KPI 4종을 계산해 반환한다.
 * 시뮬레이션 시작 직후(분모 0)에도 NaN/Infinity가 새지 않도록 각 분기에서
 * 안전한 fallback 을 둔다.
 *
 * @param {import('./simulation.js').Station} station
 * @returns {{availability: number, performance: number, quality: number, oee: number}}
 *   모두 0..1 사이 비율. UI 표시 시 ×100 한다.
 */
export function calculateKPIs(station) {
  const { operatingTime, downTime, producedCount, goodCount } = station.stats;

  // 시간가동률: 부하 시간 = operatingTime + downTime.
  // 분모 0(아직 한 번도 갱신 안 된 첫 프레임)은 100%로 둠 — "아직 손실 없음".
  const denom = operatingTime + downTime;
  const availability = denom > 0 ? operatingTime / denom : 1.0;

  // 성능가동률: 실제 가동 시간 대비 표준 사이클로 만들어졌어야 할 수량 비율.
  // 1.0을 초과하면(아주 짧은 시간에 우연히 producedCount가 앞서가는 경우) 1.0으로 cap.
  const performance = operatingTime > 0
    ? Math.min(1.0, (station.cycleTime * producedCount) / operatingTime)
    : 0;

  // 양품률: 아직 1개도 생산 안 된 시점은 100%로 둠 — "불량 발생 안 함".
  const quality = producedCount > 0 ? goodCount / producedCount : 1.0;

  const oee = availability * performance * quality;
  return { availability, performance, quality, oee };
}

/**
 * 매 프레임 main.js에서 호출. 내부적으로 0.5초마다만 DOM을 갱신한다.
 * 시뮬레이션이 일시정지여도 realDelta는 흐르므로 표시 직후 정지 시 마지막 값이 그대로 남는다.
 *
 * @param {Map<string, import('./simulation.js').Station>} stations
 * @param {number} realDelta - 실제 시간 경과(초). simState.timeScale 영향 안 받음.
 */
export function updateDashboard(stations, realDelta) {
  _accumulator += realDelta;
  if (_accumulator < UPDATE_INTERVAL) return;
  _accumulator = 0;

  _renderOverall(stations);
  _renderCards(stations);
}

/** 라인 전체 OEE 갱신. supply·shipping 제외 station들의 OEE 산술 평균. */
function _renderOverall(stations) {
  const overallEl = document.getElementById('overall-oee');
  if (!overallEl) return;

  const active = [];
  for (const station of stations.values()) {
    if (EXCLUDE_FROM_LINE_OEE.includes(station.id)) continue;
    active.push(station);
  }

  if (active.length === 0) {
    overallEl.textContent = '—';
    return;
  }

  let sum = 0;
  for (const s of active) sum += calculateKPIs(s).oee;
  const lineOEE = sum / active.length;

  overallEl.textContent = `${(lineOEE * 100).toFixed(1)}%`;
}

/**
 * 각 station 카드 렌더링.
 * - 컨테이너에 카드가 없으면 CARD_ORDER 순서로 만들고
 * - 이후엔 같은 DOM 노드를 재사용해서 textContent만 바꾼다 (DOM thrash 최소화).
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
    }
    _updateStationCard(card, station);
  }
}

/**
 * 카드 DOM 한 번만 생성. 이후엔 update만 호출.
 * innerHTML은 정적 한글 텍스트 + 상수 id만 들어가므로 안전.
 */
function _createStationCard(id) {
  const card = document.createElement('div');
  card.className = 'kpi-card';
  card.dataset.stationId = id;
  const name = STATION_DISPLAY_NAMES[id] || id;
  card.innerHTML = `
    <header class="kpi-card__header">
      <span class="kpi-card__name">${name}</span>
      <span class="kpi-card__status"></span>
    </header>
    <dl class="kpi-card__metrics">
      <dt>시간가동률</dt><dd data-metric="availability">—</dd>
      <dt>성능가동률</dt><dd data-metric="performance">—</dd>
      <dt>양품률</dt><dd data-metric="quality">—</dd>
      <dt class="kpi-card__oee-label">OEE</dt><dd class="kpi-card__oee-value" data-metric="oee">—</dd>
      <dt>누적 생산</dt><dd data-metric="produced">0개</dd>
    </dl>
  `;
  return card;
}

/** 기존 카드의 텍스트·상태 배지만 갱신한다. */
function _updateStationCard(card, station) {
  const kpis = calculateKPIs(station);
  const statusInfo = STATUS_DISPLAY[station.status] || { label: '—', class: 'idle' };

  // 상태 배지: 클래스 변형으로 색상 교체. (--processing/--blocked/--starved/--idle)
  const statusEl = card.querySelector('.kpi-card__status');
  statusEl.textContent = statusInfo.label;
  statusEl.className = `kpi-card__status kpi-card__status--${statusInfo.class}`;

  card.querySelector('[data-metric="availability"]').textContent =
    `${(kpis.availability * 100).toFixed(1)}%`;
  card.querySelector('[data-metric="performance"]').textContent =
    `${(kpis.performance * 100).toFixed(1)}%`;
  card.querySelector('[data-metric="quality"]').textContent =
    `${(kpis.quality * 100).toFixed(1)}%`;
  card.querySelector('[data-metric="oee"]').textContent =
    `${(kpis.oee * 100).toFixed(1)}%`;
  card.querySelector('[data-metric="produced"]').textContent =
    `${station.stats.producedCount}개`;
}

/**
 * Stage 4의 리셋 버튼이 stations Map을 새 인스턴스로 갈아끼우는 흐름과 잘 맞물리도록,
 * 다음 updateDashboard 호출에서 즉시 갱신이 일어나도록 throttle을 0으로 되돌리는 헬퍼.
 * (선택 사용 — main.js에서 리셋 시 호출하면 사용자 체감이 더 자연스러워진다.)
 */
export function resetDashboardThrottle() {
  _accumulator = UPDATE_INTERVAL;
}
