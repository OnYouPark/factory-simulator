// ===================================================================
// Entry point
// 1) 씬·카메라·렌더러·OrbitControls·라벨 렌더러 셋업
// 2) 공장 외곽(바닥·그리드·벽) 추가
// 3) 장비 배치 (박스 + CSS2D 라벨)
// 4) requestAnimationFrame 루프 시작
//
// factoryState 모듈 변수에 장비 목록을 보관해 Stage 3 이후(자재 흐름·
// 시뮬레이션·KPI)에서 참조할 수 있도록 export 한다.
// ===================================================================

import { setupScene } from './scene.js';
import { buildFactory } from './factory.js';
import { buildEquipment } from './equipment.js';

// 다른 모듈에서 import해서 사용할 수 있는 전역 상태.
// 초기화 전에는 비어 있고, DOMContentLoaded 이후 채워진다.
export const factoryState = {
  scene: null,
  camera: null,
  renderer: null,
  controls: null,
  labelRenderer: null,
  equipment: [],   // buildEquipment()가 돌려준 장비 객체 배열
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

  // 모듈 변수에 보관 (디버깅 편의를 위해 window에도 노출)
  factoryState.scene = scene;
  factoryState.camera = camera;
  factoryState.renderer = renderer;
  factoryState.controls = controls;
  factoryState.labelRenderer = labelRenderer;
  factoryState.equipment = equipment;
  window.factoryState = factoryState;

  // 4) 메인 애니메이션 루프
  // - controls.update()는 enableDamping이 켜져 있을 때 매 프레임 호출이 필요하다.
  // - labelRenderer.render도 매 프레임 호출해야 라벨이 카메라 이동을 따라간다.
  // - 추후 단계에서 simulationTick(dt) 같은 호출을 여기 끼워넣게 된다.
  function animate() {
    requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, camera);
    labelRenderer.render(scene, camera);
  }
  animate();
});
