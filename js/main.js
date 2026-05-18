// ===================================================================
// Entry point
// 1) 씬·카메라·렌더러·OrbitControls·라벨 렌더러 셋업
// 2) 공장 외곽(바닥·그리드·벽) 추가
// 3) 장비 배치 (박스 + CSS2D 라벨)
// 4) AGV 마커 + 자재 흐름 경로 (Stage 3)
// 5) requestAnimationFrame 루프 시작 (Clock 기반 deltaTime)
//
// factoryState 모듈 변수에 씬·장비·AGV를 보관해 Stage 4 이후(시뮬레이션·
// KPI)에서 참조할 수 있도록 export 한다.
// ===================================================================

import * as THREE from 'three';

import { setupScene } from './scene.js';
import { buildFactory } from './factory.js';
import { buildEquipment } from './equipment.js';
import { buildAGVs, updateAGVs } from './markers.js';

// 다른 모듈에서 import해서 사용할 수 있는 전역 상태.
// 초기화 전에는 비어 있고, DOMContentLoaded 이후 채워진다.
export const factoryState = {
  scene: null,
  camera: null,
  renderer: null,
  controls: null,
  labelRenderer: null,
  equipment: [],   // buildEquipment()가 돌려준 장비 객체 배열
  agvs: [],        // buildAGVs()가 돌려준 AGV 인스턴스 배열
};

document.addEventListener('DOMContentLoaded', () => {
  const container = document.getElementById('canvas-container');
  if (!container) {
    console.error('[main] #canvas-container 요소를 찾을 수 없습니다.');
    return;
  }

  // 1) 씬 셋업: scene·camera·renderer·controls·labelRenderer·조명이 한꺼번에 만들어진다.
  const { scene, camera, renderer, controls, labelRenderer } = setupScene(container);

  // 2) 공장 외곽 구성
  buildFactory(scene);

  // 3) 장비 배치 (박스 + 라벨). 반환된 목록은 다음 단계에서 사용.
  const equipment = buildEquipment(scene);

  // 4) AGV 마커 + 자재 흐름 경로
  // markers.js가 id로 장비 좌표를 빠르게 찾을 수 있도록 id→data 맵으로 변환.
  const equipmentMap = {};
  for (const item of equipment) {
    equipmentMap[item.id] = item.data;
  }
  const agvs = buildAGVs(scene, equipmentMap);

  // 모듈 변수에 보관 (디버깅 편의를 위해 window에도 노출)
  factoryState.scene = scene;
  factoryState.camera = camera;
  factoryState.renderer = renderer;
  factoryState.controls = controls;
  factoryState.labelRenderer = labelRenderer;
  factoryState.equipment = equipment;
  factoryState.agvs = agvs;
  window.factoryState = factoryState;

  // 5) 메인 애니메이션 루프
  // - THREE.Clock으로 프레임 간 경과 시간(초)을 측정 (탭 비활성/저FPS 모두 안전).
  // - controls.update()는 enableDamping이 켜져 있을 때 매 프레임 호출이 필요.
  // - labelRenderer.render도 매 프레임 호출해야 라벨이 카메라 이동을 따라간다.
  const clock = new THREE.Clock();
  function animate() {
    requestAnimationFrame(animate);
    const dt = clock.getDelta();

    // AGV 위치·상태 갱신 (TIME_SCALE은 updateAGVs 내부에서 적용)
    updateAGVs(agvs, dt);

    controls.update();
    renderer.render(scene, camera);
    labelRenderer.render(scene, camera);
  }
  animate();
});
