// ===================================================================
// Entry point
// 1) 씬·카메라·렌더러·OrbitControls 셋업
// 2) 공장 외곽(바닥·그리드·벽) 추가
// 3) requestAnimationFrame 루프 시작
// ===================================================================

import { setupScene } from './scene.js';
import { buildFactory } from './factory.js';

document.addEventListener('DOMContentLoaded', () => {
  const container = document.getElementById('canvas-container');
  if (!container) {
    console.error('[main] #canvas-container 요소를 찾을 수 없습니다.');
    return;
  }

  // 1) 씬 셋업: scene·camera·renderer·controls·조명이 한꺼번에 만들어진다.
  const { scene, camera, renderer, controls } = setupScene(container);

  // 2) 공장 외곽 구성
  buildFactory(scene);

  // 3) 메인 애니메이션 루프
  // - controls.update()는 enableDamping이 켜져 있을 때 매 프레임 호출이 필요하다.
  // - 추후 단계에서 simulationTick(dt) 같은 호출을 여기 끼워넣게 된다.
  function animate() {
    requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, camera);
  }
  animate();
});
