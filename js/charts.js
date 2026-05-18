// ===================================================================
// Stage 6: Chart.js 시각화 레이어
//
// Stage 5의 텍스트 KPI는 그대로 두고, 다음 3종 차트를 추가한다.
//   1) 메인 반원 게이지 (overall-oee-gauge) — 라인 전체 OEE
//   2) 미니 도넛 게이지 (각 station 카드 우측, 7개)
//   3) 트렌드 라인 차트 — 시뮬레이션 시간 5분 슬라이딩 윈도우
//
// 설계 메모
// - 모든 차트는 animation: false, update('none') 으로 즉시 갱신.
//   시뮬레이션 가속(300x)에서도 프레임 마다 끊기지 않게 한다.
// - 일시정지 시 dashboard 호출이 매 프레임 들어와도 trendData는
//   시뮬레이션 시간 기준으로만 샘플링되므로 자연스럽게 멈춘다.
// - Chart.js 인스턴스는 모듈 전역으로 보관해 dashboard.js와 main.js에서
//   참조하는 인터페이스는 함수 export 만으로 한다 (캡슐화).
// ===================================================================

import Chart from 'chart.js/auto';

// ---------- OEE 색상 단계 (JIPM 통상 기준) ----------
// 80%+ 우수 / 60%+ 양호 / 40%+ 보통 / 그 외 나쁨
function gaugeColor(oee) {
  if (oee >= 0.80) return '#4A7A4A';   // 녹색
  if (oee >= 0.60) return '#D4A017';   // 노랑
  if (oee >= 0.40) return '#E67E22';   // 주황
  return '#C0392B';                     // 빨강
}

// 게이지 빈 트랙 색 (남은 영역). 카드/패널 배경에서 살짝 떠 보이도록 옅은 흰.
const TRACK_COLOR = 'rgba(255, 255, 255, 0.06)';

// 트렌드 라인 색은 디자인 시스템 accent.
const TREND_LINE_COLOR = '#6b9bd8';
const TREND_FILL_COLOR = 'rgba(107, 155, 216, 0.15)';

// ---------- 차트 인스턴스 보관 (모듈 전역) ----------
let overallGauge = null;
let trendChart = null;
const miniGauges = new Map();   // stationId -> Chart 인스턴스

// ---------- 트렌드 샘플링 파라미터 ----------
// 시뮬레이션 시간 5초마다 1포인트, 최대 60포인트(=5분).
// 5분 슬라이딩 윈도우: 새 포인트가 들어오면 가장 오래된 것을 shift.
const TREND_SAMPLE_INTERVAL = 5;
const TREND_MAX_POINTS = 60;
let lastTrendSampleTime = 0;
const trendData = { labels: [], values: [] };

// ===================================================================
// 초기화
// ===================================================================

/**
 * DOMContentLoaded 시점에 1회 호출. 메인 게이지와 트렌드 차트를 생성한다.
 * 미니 게이지는 dashboard.js가 카드를 생성할 때마다 initMiniGauge로 추가한다.
 */
export function initCharts() {
  const overallCanvas = document.getElementById('overall-oee-gauge');
  if (overallCanvas) {
    overallGauge = new Chart(overallCanvas, {
      type: 'doughnut',
      data: {
        datasets: [{
          data: [0, 100],
          backgroundColor: [TREND_LINE_COLOR, TRACK_COLOR],
          borderWidth: 0,
        }],
      },
      options: {
        rotation: -90,          // 반원: 좌측 9시 방향에서 시작
        circumference: 180,     // 반원
        cutout: '75%',          // 게이지 두께 (얇게)
        animation: false,
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: { enabled: false },
        },
      },
    });
  }

  const trendCanvas = document.getElementById('trend-chart-canvas');
  if (trendCanvas) {
    trendChart = new Chart(trendCanvas, {
      type: 'line',
      data: {
        labels: [],
        datasets: [{
          data: [],
          label: '라인 OEE',
          borderColor: TREND_LINE_COLOR,
          backgroundColor: TREND_FILL_COLOR,
          fill: true,
          tension: 0.3,
          pointRadius: 0,
          borderWidth: 1.5,
        }],
      },
      options: {
        animation: false,
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: { enabled: false },
        },
        scales: {
          x: {
            ticks: {
              color: '#9ca3af',
              font: { size: 10 },
              maxRotation: 0,
              // 60포인트(=5분 윈도우)에서 라벨이 겹치지 않도록 최대 6개만 표시.
              // autoSkip을 명시해 Chart.js가 자동으로 솎아내게 한다.
              maxTicksLimit: 6,
              autoSkip: true,
            },
            grid: { color: 'rgba(255,255,255,0.05)' },
          },
          y: {
            min: 0,
            max: 100,
            ticks: {
              color: '#9ca3af',
              font: { size: 10 },
              callback: (v) => `${v}%`,
            },
            grid: { color: 'rgba(255,255,255,0.05)' },
          },
        },
      },
    });
  }
}

/**
 * 각 station 카드 생성 시 dashboard.js가 호출.
 * 카드 내 canvas[data-mini-gauge]에 도넛 게이지 인스턴스를 부착한다.
 * 동일 stationId로 중복 호출되면 기존 인스턴스를 파괴 후 재생성 (리셋 안전망).
 *
 * @param {string} stationId
 * @param {HTMLCanvasElement} canvasEl
 */
export function initMiniGauge(stationId, canvasEl) {
  const existing = miniGauges.get(stationId);
  if (existing) existing.destroy();

  const chart = new Chart(canvasEl, {
    type: 'doughnut',
    data: {
      datasets: [{
        data: [0, 100],
        backgroundColor: [TREND_LINE_COLOR, TRACK_COLOR],
        borderWidth: 0,
      }],
    },
    options: {
      rotation: 0,
      circumference: 360,
      cutout: '68%',
      animation: false,
      responsive: true,
      maintainAspectRatio: true,
      plugins: {
        legend: { display: false },
        tooltip: { enabled: false },
      },
    },
  });
  miniGauges.set(stationId, chart);
}

// ===================================================================
// 갱신 API (dashboard.js에서 0.5초 throttle된 빈도로 호출)
// ===================================================================

/** 메인 반원 게이지를 라인 OEE(0..1) 로 갱신. */
export function updateOverallGauge(lineOEE) {
  if (!overallGauge) return;
  const pct = clamp01(lineOEE) * 100;
  overallGauge.data.datasets[0].data = [pct, 100 - pct];
  overallGauge.data.datasets[0].backgroundColor = [gaugeColor(lineOEE), TRACK_COLOR];
  overallGauge.update('none');
}

/** 특정 station 미니 게이지를 OEE(0..1) 로 갱신. */
export function updateMiniGauge(stationId, oee) {
  const chart = miniGauges.get(stationId);
  if (!chart) return;
  const pct = clamp01(oee) * 100;
  chart.data.datasets[0].data = [pct, 100 - pct];
  chart.data.datasets[0].backgroundColor = [gaugeColor(oee), TRACK_COLOR];
  chart.update('none');
}

/**
 * 트렌드 라인에 한 포인트를 추가한다. 시뮬레이션 시간이 TREND_SAMPLE_INTERVAL 만큼
 * 더 흐른 경우에만 실제 push (그 외엔 no-op). 60포인트(=5분)를 넘으면 슬라이딩.
 *
 * @param {number} simulationTime - 시뮬레이션 누적 시간 (초)
 * @param {number} lineOEE - 0..1
 */
export function recordTrendSample(simulationTime, lineOEE) {
  if (simulationTime - lastTrendSampleTime < TREND_SAMPLE_INTERVAL) return;
  lastTrendSampleTime = simulationTime;

  const m = Math.floor(simulationTime / 60);
  const s = Math.floor(simulationTime % 60);
  const label = `${m}:${String(s).padStart(2, '0')}`;

  trendData.labels.push(label);
  trendData.values.push(+(clamp01(lineOEE) * 100).toFixed(1));

  while (trendData.labels.length > TREND_MAX_POINTS) {
    trendData.labels.shift();
    trendData.values.shift();
  }

  if (trendChart) {
    trendChart.data.labels = trendData.labels;
    trendChart.data.datasets[0].data = trendData.values;
    trendChart.update('none');
  }
}

/**
 * 리셋 버튼이 눌렸을 때 main.js에서 호출.
 * 차트 인스턴스는 그대로 유지하고 데이터만 비운다 (canvas 재생성 비용 회피).
 */
export function resetCharts() {
  trendData.labels = [];
  trendData.values = [];
  lastTrendSampleTime = 0;

  if (trendChart) {
    trendChart.data.labels = [];
    trendChart.data.datasets[0].data = [];
    trendChart.update('none');
  }
  if (overallGauge) {
    overallGauge.data.datasets[0].data = [0, 100];
    overallGauge.data.datasets[0].backgroundColor = [TREND_LINE_COLOR, TRACK_COLOR];
    overallGauge.update('none');
  }
  for (const chart of miniGauges.values()) {
    chart.data.datasets[0].data = [0, 100];
    chart.data.datasets[0].backgroundColor = [TREND_LINE_COLOR, TRACK_COLOR];
    chart.update('none');
  }
}

// ---------- 유틸 ----------
function clamp01(v) {
  if (!Number.isFinite(v)) return 0;
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}
