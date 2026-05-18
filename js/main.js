// ===================================================================
// Entry point
// 1) 씬·카메라·렌더러·OrbitControls·라벨 렌더러 셋업
// 2) 공장 외곽(바닥·그리드·벽) 추가
// 3) 장비 배치 (박스 + CSS2D 라벨)
// 4) Station 인스턴스(=시뮬레이션 모델) 생성
// 5) AGV 마커 + 자재 흐름 경로 (Station 큐 참조)
// 6) 시뮬레이션 컨트롤 UI 바인딩 (일시정지·리셋·속도 슬라이더)
// 7) requestAnimationFrame 루프 시작 (Clock 기반 deltaTime)
//
// factoryState 모듈 변수에 씬·장비·AGV·stations·simState를 보관해
// 디버깅과 Stage 5 이후(KPI 대시보드)에서 참조할 수 있도록 export 한다.
// ===================================================================

import * as THREE from 'three';

import { setupScene } from './scene.js';
import { buildFactory } from './factory.js';
import { buildEquipment, updateEquipmentVisuals } from './equipment.js';
import { buildAGVs, updateAGVs } from './markers.js';
import { createStations, updateStations } from './simulation.js';
import { updateDashboard, resetDashboardThrottle } from './dashboard.js';
import { TIME } from './config.js';

// 다른 모듈에서 import해서 사용할 수 있는 전역 상태.
export const factoryState = {
  scene: null,
  camera: null,
  renderer: null,
  controls: null,
  labelRenderer: null,
  equipment: [],
  agvs: [],
  stations: null,        // Map<id, Station>
  simState: null,        // { running, timeScale, simulationTime }
};

document.addEventListener('DOMContentLoaded', () => {
  const container = document.getElementById('canvas-container');
  if (!container) {
    console.error('[main] #canvas-container 요소를 찾을 수 없습니다.');
    return;
  }

  // 1) 씬 셋업
  const { scene, camera, renderer, controls, labelRenderer } = setupScene(container);

  // 2) 공장 외곽
  buildFactory(scene);

  // 3) 장비 배치
  const equipment = buildEquipment(scene);

  // id → equipment data 맵 (markers.js가 좌표 조회용으로 사용)
  const equipmentMap = {};
  for (const item of equipment) {
    equipmentMap[item.id] = item.data;
  }

  // 4) 시뮬레이션 Station 인스턴스 생성
  let stations = createStations();

  // 5) AGV 마커 — Station 인스턴스를 직접 참조
  let agvs = buildAGVs(scene, equipmentMap, stations);

  // 6) 시뮬레이션 상태
  // - running: 일시정지 여부
  // - timeScale: 시간 가속 (TIME.scaleOptions에서 선택)
  // - simulationTime: 시뮬레이션 내부 누적 시간 (초)
  const simState = {
    running: true,
    timeScale: TIME.defaultScale,
    simulationTime: 0,
  };

  factoryState.scene = scene;
  factoryState.camera = camera;
  factoryState.renderer = renderer;
  factoryState.controls = controls;
  factoryState.labelRenderer = labelRenderer;
  factoryState.equipment = equipment;
  factoryState.agvs = agvs;
  factoryState.stations = stations;
  factoryState.simState = simState;
  window.factoryState = factoryState;

  // ---------- 시뮬레이션 컨트롤 UI 바인딩 ----------
  const btnPause = document.getElementById('btn-pause');
  const btnReset = document.getElementById('btn-reset');
  const speedSlider = document.getElementById('speed-slider');
  const speedDisplay = document.getElementById('speed-display');
  const simTimeEl = document.getElementById('sim-time');
  const statusTextEl = document.getElementById('status-text');

  // 일시정지/재생 토글
  btnPause.addEventListener('click', () => {
    simState.running = !simState.running;
    btnPause.textContent = simState.running ? '⏸' : '▶';
    btnPause.title = simState.running ? '일시정지' : '재생';
  });

  // 슬라이더 → timeScale
  // 슬라이더 값(0~5)을 TIME.scaleOptions 인덱스로 매핑
  speedSlider.addEventListener('input', (e) => {
    const idx = parseInt(e.target.value, 10);
    const scale = TIME.scaleOptions[idx] ?? TIME.defaultScale;
    simState.timeScale = scale;
    speedDisplay.textContent = `${scale}x`;
  });

  // 슬라이더 초기값을 defaultScale에 맞춰 보정 (HTML 기본 value="2" 와 동기)
  {
    const idx = TIME.scaleOptions.indexOf(TIME.defaultScale);
    if (idx >= 0) speedSlider.value = String(idx);
    speedDisplay.textContent = `${simState.timeScale}x`;
  }

  // 리셋: stations·agvs를 새로 만들고 시뮬레이션 시간 0으로
  btnReset.addEventListener('click', () => {
    // 기존 AGV 메쉬를 씬에서 제거
    for (const agv of agvs) agv.dispose(scene);

    stations = createStations();
    agvs = buildAGVs(scene, equipmentMap, stations);
    simState.simulationTime = 0;

    factoryState.stations = stations;
    factoryState.agvs = agvs;

    // 리셋 직후 한 프레임 안에 KPI 표시가 0%로 동기화되도록 throttle을 강제 만료시킴.
    resetDashboardThrottle();
  });

  // 7) 메인 애니메이션 루프
  // - simState.running 이 false면 시뮬레이션 갱신은 멈추되 OrbitControls/렌더는 계속.
  //   → 일시정지 중에도 카메라 조작은 자유.
  // - simDelta(=realDelta * timeScale) 를 simulation·AGV에 전달.
  // - 깜박임 위상은 실시간 기준(realDelta)으로 계산해서 일시정지 시에도 자연스럽게 멈춤.
  const clock = new THREE.Clock();
  function animate() {
    requestAnimationFrame(animate);
    const realDelta = clock.getDelta();

    if (simState.running) {
      const simDelta = realDelta * simState.timeScale;
      simState.simulationTime += simDelta;
      updateStations(factoryState.stations, simDelta);
      updateAGVs(factoryState.agvs, simDelta);
      updateEquipmentVisuals(equipment, factoryState.stations, realDelta);
    }

    // 상태바·KPI 대시보드는 일시정지 중에도 매 프레임 호출.
    // - 상태바: "일시정지" 텍스트로 즉시 전환되도록.
    // - KPI 대시보드: 내부 throttle(0.5초)로 자체 조절. 시뮬레이션이 멈춰 있으면
    //   Station.stats가 변하지 않으므로 표시 값이 자연스럽게 동결됨.
    updateStatusBar();
    updateDashboard(factoryState.stations, realDelta);

    controls.update();
    renderer.render(scene, camera);
    labelRenderer.render(scene, camera);
  }

  function updateStatusBar() {
    simTimeEl.textContent = formatTime(simState.simulationTime);
    const shipping = factoryState.stations.get('shipping');
    const completed = shipping ? shipping.stats.producedCount : 0;
    const runText = simState.running ? '가동 중' : '일시정지';
    statusTextEl.textContent =
      `시뮬레이션 시간: ${formatTime(simState.simulationTime)} | ${runText} | 누적 완성품: ${completed}개`;
  }

  animate();
});

/**
 * 초(소수 포함)를 HH:MM:SS 문자열로 포맷.
 * 시뮬레이션 내부 시간이므로 24시간을 넘으면 그대로 자릿수가 늘어난다.
 */
function formatTime(totalSeconds) {
  const s = Math.floor(totalSeconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(h)}:${pad(m)}:${pad(sec)}`;
}
