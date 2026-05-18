// ===================================================================
// 장비 배치 모듈
// - config.js의 EQUIPMENT 배열을 읽어 박스형 메쉬 + CSS2D 라벨을 생성한다.
// - 데이터(config)와 렌더링(이 파일)을 분리해 두면, 추후 .glb 모델로
//   교체할 때 createEquipmentMesh()만 갈아끼우면 된다.
// - 반환된 장비 객체 배열은 Stage 3 이후(자재 흐름·시뮬레이션·KPI)에서
//   장비 위치·메쉬·메타데이터 참조용으로 그대로 재사용된다.
// ===================================================================

import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';

import { EQUIPMENT, EQUIPMENT_RENDER } from './config.js';

/**
 * 모든 장비를 씬에 추가한다.
 * @param {THREE.Scene} scene
 * @returns {Array<{id, data, mesh, label}>} 생성된 장비 객체 목록
 *   - id: 장비 고유 식별자 (config의 id 그대로)
 *   - data: config의 원본 데이터 (position, type, partType 등)
 *   - mesh: THREE.Mesh (박스 본체)
 *   - label: THREE.CSS2DObject (라벨, mesh의 자식)
 */
export function buildEquipment(scene) {
  const equipmentList = [];

  for (const data of EQUIPMENT) {
    const { mesh, label } = createEquipmentMesh(data);
    scene.add(mesh);
    // 라벨은 mesh의 자식으로 붙여둠 → mesh 위치 변경 시 라벨도 따라온다.
    // (CSS2DObject는 mesh.add(label) 시점에 함께 렌더링 트리에 들어감)
    equipmentList.push({
      id: data.id,
      data,
      mesh,
      label,
    });
  }

  return equipmentList;
}

/**
 * 단일 장비의 메쉬와 라벨을 생성한다.
 * 박스 색상·재질은 EQUIPMENT_RENDER에 따른 임시값. 추후 .glb 교체 시 이 함수만 바꾼다.
 *
 * @param {Object} data - EQUIPMENT 배열의 한 항목
 * @returns {{mesh: THREE.Mesh, label: CSS2DObject}}
 */
export function createEquipmentMesh(data) {
  // ---------- 박스 본체 ----------
  const { w, h, d } = data.size;
  const geometry = new THREE.BoxGeometry(w, h, d);
  const material = new THREE.MeshStandardMaterial({
    color: data.color,
    roughness: EQUIPMENT_RENDER.roughness,
    metalness: EQUIPMENT_RENDER.metalness,
  });
  const mesh = new THREE.Mesh(geometry, material);

  mesh.position.set(data.position.x, data.position.y, data.position.z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;

  // 추후 클릭 인터랙션·자재 흐름 계산에서 장비 메타데이터를 빠르게 찾기 위해
  // 메쉬 자체에 원본 데이터를 매달아 둔다.
  mesh.userData.equipmentData = data;

  // ---------- 라벨 (CSS2DObject) ----------
  const labelDiv = document.createElement('div');
  labelDiv.className = 'equipment-label';
  // data.name의 개행(\n)을 <br>로 치환. 한국어 2줄 라벨을 가독성 있게 표시.
  // (원본 텍스트는 코드 상수이므로 innerHTML 사용해도 안전)
  labelDiv.innerHTML = escapeForLabel(data.name);

  const label = new CSS2DObject(labelDiv);
  // 박스 로컬 좌표 기준: 상단(=h/2)에서 추가 오프셋만큼 위로 띄움.
  label.position.set(0, h / 2 + EQUIPMENT_RENDER.labelYOffset, 0);
  mesh.add(label);

  return { mesh, label };
}

/**
 * 라벨용 텍스트 처리.
 * - HTML 특수문자를 이스케이프하고
 * - 개행 문자 \n만 <br>로 치환한다.
 *
 * 현재 EQUIPMENT의 name은 모두 상수이지만, 추후 동적 라벨(예: 가동률 %)에서
 * 사용자 입력이 흘러들어와도 안전하도록 미리 이스케이프 헬퍼로 막아둔다.
 */
function escapeForLabel(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/\n/g, '<br>');
}
