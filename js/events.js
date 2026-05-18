// ===================================================================
// Stage 7: 이벤트 트리거 (수동·자동) + 토스트 알림
//
// - 수동 이벤트: 상단 툴바의 버튼으로 시연 중 즉시 다운타임을 발동.
// - 자동 이벤트: 시뮬레이션 시간 1분마다 station별 5% 확률로 자연 다운타임 발생.
// - Station.triggerDowntime()을 호출하므로 시뮬레이션·KPI 모델이 그대로 반영.
// - 토스트: 우상단에 4초간 슬라이드 인/아웃. CSS transition으로 부드럽게.
// - 완료 감지: 매 호출마다 활성 다운을 점검해 자동 해제 시 "완료" 토스트.
// ===================================================================

// ---------- 수동 이벤트 정의 ----------
// stationId / 표시 라벨 / 정지 시간(시뮬레이션 시간 초).
// 90초·60초는 시연 적정값 — 30배속 기준 3초·2초로 체감되며 KPI 하락이
// 트렌드 차트의 V자 곡선으로 명확히 보임.
export const MANUAL_EVENTS = {
  'mold-change-1': { stationId: 'injection-1', label: '#1 금형 교체', duration: 90 },
  'mold-change-2': { stationId: 'injection-2', label: '#2 금형 교체', duration: 90 },
  'mold-change-3': { stationId: 'injection-3', label: '#3 금형 교체', duration: 90 },
  'supply-delay':  { stationId: 'supply',      label: '공급 지연',    duration: 60 },
};

// ---------- 자동 이벤트 설정 ----------
// 기본 비활성 — 시연·관찰 시 라인 OEE가 자동 다운으로 과도하게 떨어지는 것을 막는다.
// (이전 5%/분 × 5 station 설정에서 시뮬 2시간 누적 시 OEE 3% 수준까지 하락하는 문제가 있었음)
// 자동 이벤트가 필요한 경우 enabled를 true로 변경.
// 출하·공급은 자동 다운 대상에서 제외 — supply는 수동 '공급 지연' 전용, shipping은
// 사실상 무한 용량이라 다운 시연 가치가 없다.
export const AUTO_EVENT_CONFIG = {
  enabled: false,
  checkIntervalSeconds: 60,
  perStationProbability: 0.01,   // 활성 시에도 보수적 (1%/분)
  durationRange: [30, 60],       // 최대 지속을 90→60으로 단축
  applicableStations: ['injection-1', 'injection-2', 'injection-3', 'surface', 'assembly'],
};

// 마지막 자동 이벤트 체크 시각 (시뮬레이션 시간 기준).
let lastAutoCheckTime = 0;

// 활성 강제 다운 추적 — 자동 해제 감지용.
// Map<stationId, { reason }>. 토스트로 사용자가 본 라벨을 그대로 "(라벨) 완료"에 다시 씀.
const _activeDowns = new Map();

/**
 * 수동 이벤트 버튼 클릭 시 호출.
 * 이미 정지 중인 station이면 중복 트리거를 막고 경고 토스트만 표시.
 *
 * @param {string} eventKey - MANUAL_EVENTS의 키
 * @param {Map<string, import('./simulation.js').Station>} stations
 */
export function triggerManualEvent(eventKey, stations) {
  const event = MANUAL_EVENTS[eventKey];
  if (!event) return;
  const station = stations.get(event.stationId);
  if (!station) return;
  if (station.forcedDown) {
    showToast(`${event.label}: 이미 정지 중`, 'warning');
    return;
  }
  station.triggerDowntime(event.duration, event.label);
  _activeDowns.set(station.id, { reason: event.label });
  showToast(`${event.label} 시작 (${event.duration}초)`, 'info');
}

/**
 * 시뮬레이션 루프에서 매 프레임 호출. 두 가지 일을 한다:
 *   1) 활성 강제 다운이 자동 해제됐는지 체크해 "완료" 토스트 표시 (매 호출).
 *   2) checkIntervalSeconds 마다 자동 이벤트 확률 추첨 (throttle).
 *
 * @param {Map<string, import('./simulation.js').Station>} stations
 * @param {number} simulationTime - 시뮬레이션 누적 시간(초)
 */
export function processAutoEvents(stations, simulationTime) {
  // 1) 완료 감지 — 매 호출. forcedDown이 풀린 station에 대해 토스트 + 추적 해제.
  for (const [stationId, info] of _activeDowns) {
    const station = stations.get(stationId);
    if (!station || !station.forcedDown) {
      _activeDowns.delete(stationId);
      if (station) showToast(`${info.reason} 완료`, 'info');
    }
  }

  // 2) 자동 이벤트 추첨 — throttle 적용.
  if (!AUTO_EVENT_CONFIG.enabled) return;
  if (simulationTime - lastAutoCheckTime < AUTO_EVENT_CONFIG.checkIntervalSeconds) return;
  lastAutoCheckTime = simulationTime;

  for (const stationId of AUTO_EVENT_CONFIG.applicableStations) {
    const station = stations.get(stationId);
    if (!station || station.forcedDown) continue;
    if (Math.random() < AUTO_EVENT_CONFIG.perStationProbability) {
      const [min, max] = AUTO_EVENT_CONFIG.durationRange;
      const duration = min + Math.random() * (max - min);
      const reason = '자동 다운';
      station.triggerDowntime(duration, reason);
      _activeDowns.set(stationId, { reason });
      showToast(`${stationId} 자동 다운 (${Math.round(duration)}초)`, 'warning');
    }
  }
}

/**
 * 리셋 버튼이 눌렸을 때 main.js에서 호출.
 * 자동 이벤트 타이머·활성 다운 추적·표시된 토스트를 모두 초기화한다.
 * (Station 인스턴스 자체는 createStations()가 새로 만들어 forcedDown=false 상태)
 */
export function resetEvents() {
  lastAutoCheckTime = 0;
  _activeDowns.clear();
  const container = document.getElementById('toast-container');
  if (container) container.innerHTML = '';
}

/**
 * 우상단 토스트 알림. 4초 후 자동 제거, slide-in/out 애니메이션은 CSS 담당.
 *
 * @param {string} message
 * @param {'info' | 'warning' | 'error'} [type='info']
 */
export function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast toast--${type}`;
  toast.textContent = message;
  container.appendChild(toast);

  // 다음 프레임에 visible 클래스 추가 — CSS transition이 작동하려면
  // 초기 상태(opacity 0, translateX 20px)가 한 프레임은 적용돼야 한다.
  requestAnimationFrame(() => toast.classList.add('toast--visible'));

  // 4초 후 페이드 아웃, 0.3초 후 DOM 제거.
  setTimeout(() => {
    toast.classList.remove('toast--visible');
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}
