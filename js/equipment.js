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

import { EQUIPMENT, EQUIPMENT_RENDER, PART_COLORS } from './config.js';

// ---------- 상태별 emissive 색상 ----------
// 시뮬레이션 status를 한눈에 식별하도록 emissive 색상으로 표시한다.
//   - idle:       어두운 회색 (사실상 변화 없음)
//   - processing: 부품 색을 30% 밝기로 emissive (생산 중인 부품 색 힌트)
//   - blocked:    빨강. 1Hz 깜박임 (출력 큐 가득 → 멈춰 있음)
//   - starved:    회색 (입력 부족으로 대기)
const STATUS_EMISSIVE = {
  blocked: 0xC0392B,
  starved: 0x6b7280,
  // Stage 7: 강제 다운(이벤트). blocked보다 진한 적색·깜박임 없음 (계획된 정지)
  down:    0x8B1A2B,
};
const PROCESSING_EMISSIVE_FACTOR = 0.30;  // 부품 색을 어둡게 해서 은은한 발광 느낌
const BLINK_HZ = 1;                       // blocked 깜박임 주기 (초당 회수)
// 깜박임 위상 누적용 모듈 변수 — updateEquipmentVisuals 호출 사이에 유지된다.
let _blinkPhase = 0;

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
 * 매 프레임 호출되어 각 장비 메쉬의 emissive를 station.status 에 따라 갱신한다.
 *
 * 메쉬 자체는 건드리지 않고(geometry·base color 유지) emissive만 조작하므로
 * 외형은 그대로 두고 상태 정보만 시각화한다.
 *
 * @param {Array<{id, data, mesh}>} equipmentList - buildEquipment 결과
 * @param {Map<string, import('./simulation.js').Station>} stations
 * @param {number} realDeltaSeconds - 실제 시간 경과 (깜박임 위상용; timeScale 영향 안 받음)
 */
export function updateEquipmentVisuals(equipmentList, stations, realDeltaSeconds = 0) {
  _blinkPhase = (_blinkPhase + realDeltaSeconds * BLINK_HZ) % 1;
  // 깜박임 강도: 0~1 사인파 (0.4 ~ 1.0 범위로 보정해 너무 꺼지지 않게)
  const blinkIntensity = 0.4 + 0.6 * (0.5 + 0.5 * Math.sin(_blinkPhase * Math.PI * 2));

  for (const item of equipmentList) {
    const station = stations.get(item.id);
    if (!station) continue;  // 시뮬레이션 station이 없는 장비는 스킵 (현재는 없음)
    const mat = item.mesh.material;

    switch (station.status) {
      case 'processing': {
        // 현재 처리 중인 부품의 색을 어둡게 해서 emissive로 사용.
        // injection/supply 는 partType 색, 그 외(surface/assembly/shipping)는
        // currentItem.type 색 — assembly 처리 중에는 'completed' 색이 들어감.
        const partType = station.currentItem?.type || station.partType;
        const baseColor = PART_COLORS[partType];
        if (baseColor !== undefined) {
          mat.emissive.setHex(baseColor);
          mat.emissiveIntensity = PROCESSING_EMISSIVE_FACTOR;
        } else {
          // partType이 없는 station(없을 가능성 낮음)은 옅은 흰빛
          mat.emissive.setHex(0x444444);
          mat.emissiveIntensity = PROCESSING_EMISSIVE_FACTOR;
        }
        break;
      }
      case 'blocked': {
        mat.emissive.setHex(STATUS_EMISSIVE.blocked);
        mat.emissiveIntensity = blinkIntensity;  // 깜박임
        break;
      }
      case 'starved': {
        mat.emissive.setHex(STATUS_EMISSIVE.starved);
        mat.emissiveIntensity = 0.5;
        break;
      }
      case 'down': {
        // 계획된 정지 — 깜박임 없이 정적 적색으로 표시.
        mat.emissive.setHex(STATUS_EMISSIVE.down);
        mat.emissiveIntensity = 0.7;
        break;
      }
      case 'idle':
      default: {
        // 원래 색상 복귀 — emissive를 검정으로 두면 base color만 보인다.
        mat.emissive.setHex(0x000000);
        mat.emissiveIntensity = 0;
        break;
      }
    }
  }
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
