// ===================================================================
// 공장 외곽: 바닥 + 그리드 + 4면 외곽 벽
// - 이후 단계에서 buildEquipment(), buildLanes() 등이 추가될 예정
// - 모든 크기·색상은 config.js의 상수를 사용
// ===================================================================

import * as THREE from 'three';
import { FACTORY, COLORS } from './config.js';

/**
 * 공장 외곽 구조물(바닥·그리드·벽)을 씬에 추가한다.
 * @param {THREE.Scene} scene
 */
export function buildFactory(scene) {
  addFloor(scene);
  addGrid(scene);
  addWalls(scene);
}

// ---------- 바닥 ----------
// PlaneGeometry는 기본적으로 XY평면이므로 -π/2 회전해서 XZ평면(바닥)에 눕힌다.
function addFloor(scene) {
  const geometry = new THREE.PlaneGeometry(FACTORY.width, FACTORY.depth);
  const material = new THREE.MeshStandardMaterial({
    color: COLORS.floor,
    roughness: 0.9,
  });
  const floor = new THREE.Mesh(geometry, material);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);
}

// ---------- 그리드 ----------
// GridHelper는 size × size 영역을 divisions 개수로 나눠 격자선을 그린다.
// 공장이 60 × 40이지만 그리드는 정사각이라 size=60으로 잡고 divisions=60 → 1m 단위.
// 바닥과의 Z-fighting을 피하려고 y를 살짝 띄운다.
function addGrid(scene) {
  const size = FACTORY.width;
  const divisions = FACTORY.width; // 1m 한 칸
  const grid = new THREE.GridHelper(
    size,
    divisions,
    COLORS.gridMajor,
    COLORS.gridMinor
  );
  grid.position.y = 0.01;
  scene.add(grid);
}

// ---------- 외곽 벽 ----------
// 4면 벽을 BoxGeometry로 만든다. 반투명으로 처리해서 카메라가 가까이 가도
// 안쪽 시야를 막지 않도록 한다 (시연 시 회전 자유도 확보).
function addWalls(scene) {
  const h = FACTORY.wallHeight;
  const t = FACTORY.wallThickness;
  const w = FACTORY.width;
  const d = FACTORY.depth;

  const material = new THREE.MeshStandardMaterial({
    color: COLORS.wall,
    transparent: true,
    opacity: 0.4,
    roughness: 0.8,
  });

  // 벽 4면: 북(z=-d/2), 남(z=+d/2), 서(x=-w/2), 동(x=+w/2)
  // 박스의 중심 y를 h/2로 두어 바닥에 딱 붙도록 한다.
  const walls = [
    // 북쪽 벽: X 방향 길이 w
    { size: [w, h, t], pos: [0, h / 2, -d / 2] },
    // 남쪽 벽
    { size: [w, h, t], pos: [0, h / 2,  d / 2] },
    // 서쪽 벽: Z 방향 길이 d
    { size: [t, h, d], pos: [-w / 2, h / 2, 0] },
    // 동쪽 벽
    { size: [t, h, d], pos: [ w / 2, h / 2, 0] },
  ];

  for (const spec of walls) {
    const geom = new THREE.BoxGeometry(...spec.size);
    const mesh = new THREE.Mesh(geom, material);
    mesh.position.set(...spec.pos);
    mesh.castShadow = false;    // 반투명 벽이 그림자를 던지면 부자연스러움
    mesh.receiveShadow = true;
    scene.add(mesh);
  }
}
