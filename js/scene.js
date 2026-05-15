// ===================================================================
// Three.js 씬·카메라·렌더러·조명·OrbitControls 셋업
// - 메인 파일(main.js)에서 setupScene(container)를 호출해서 사용
// - 윈도우 리사이즈 이벤트는 이 모듈 안에서 자동 등록한다
// ===================================================================

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

import { CAMERA, COLORS, LIGHTING, CONTROLS } from './config.js';

/**
 * Three.js 씬 셋업.
 * @param {HTMLElement} container - renderer.domElement를 append할 컨테이너
 * @returns {{scene, camera, renderer, controls}} 메인 루프에서 쓰는 객체들
 */
export function setupScene(container) {
  // ---------- 씬 ----------
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(COLORS.bgCanvas);

  // ---------- 카메라 ----------
  // aspect는 컨테이너 크기 기준. 초기 사이즈가 0이면 1로 fallback (리사이즈에서 곧 교정됨).
  const width = container.clientWidth || 1;
  const height = container.clientHeight || 1;
  const camera = new THREE.PerspectiveCamera(
    CAMERA.fov,
    width / height,
    CAMERA.near,
    CAMERA.far
  );
  camera.position.set(
    CAMERA.initialPosition.x,
    CAMERA.initialPosition.y,
    CAMERA.initialPosition.z
  );
  camera.lookAt(0, 0, 0);

  // ---------- 렌더러 ----------
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(width, height);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.appendChild(renderer.domElement);

  // ---------- OrbitControls ----------
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 0, 0);
  controls.enableDamping = true;
  controls.dampingFactor = CONTROLS.dampingFactor;
  controls.minPolarAngle = CONTROLS.minPolarAngle;
  controls.maxPolarAngle = CONTROLS.maxPolarAngle;
  controls.minDistance = CAMERA.minDistance;
  controls.maxDistance = CAMERA.maxDistance;

  // ---------- 조명 ----------
  // AmbientLight: 전체적인 밝기 보정 (그림자 부분이 새카매지지 않도록)
  const ambient = new THREE.AmbientLight(
    COLORS.ambientLight,
    LIGHTING.ambientIntensity
  );
  scene.add(ambient);

  // DirectionalLight: 태양광 같은 평행광. 그림자를 던진다.
  const directional = new THREE.DirectionalLight(
    COLORS.directionalLight,
    LIGHTING.directionalIntensity
  );
  directional.position.set(
    LIGHTING.directionalPosition.x,
    LIGHTING.directionalPosition.y,
    LIGHTING.directionalPosition.z
  );
  directional.castShadow = true;
  directional.shadow.mapSize.set(LIGHTING.shadowMapSize, LIGHTING.shadowMapSize);
  // 그림자 카메라(orthographic) 범위. 공장 전체를 덮을 만큼 충분히 크게.
  const sc = directional.shadow.camera;
  sc.left = LIGHTING.shadowCamera.left;
  sc.right = LIGHTING.shadowCamera.right;
  sc.top = LIGHTING.shadowCamera.top;
  sc.bottom = LIGHTING.shadowCamera.bottom;
  sc.near = LIGHTING.shadowCamera.near;
  sc.far = LIGHTING.shadowCamera.far;
  sc.updateProjectionMatrix();
  scene.add(directional);

  // ---------- 리사이즈 핸들러 ----------
  window.addEventListener('resize', () => {
    const w = container.clientWidth || 1;
    const h = container.clientHeight || 1;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
  });

  return { scene, camera, renderer, controls };
}
