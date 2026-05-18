// ===================================================================
// Stage 4: AGV 마커 시스템 — Station 큐와 연동된 라이프사이클
//
// Stage 3 에서는 AGV가 단순히 시간 기반으로 왕복만 했다면, Stage 4에서는
// AGV가 Station의 출력/입력 큐와 직접 상호작용한다.
//
// ▶ 멀티-레그 운반 (waypoints가 3개 이상인 경우)
//   ROUTES의 waypoints가 [A, B, C] 처럼 3개라면 AGV는 2개의 레그로 나눠 운반한다.
//   예) lens-loop = [injection-1, surface, assembly]
//     레그 0: injection-1(출력 큐) → surface(입력 큐 'lens')
//     레그 1: surface(출력 큐)     → assembly(입력 큐 'lens')
//   각 레그의 다음 픽업 지점은 직전 드롭 지점과 같으므로, AGV는 그 자리에서
//   해당 station의 사이클(처리 시간)을 기다린다. 이 대기가 곧 라인의
//   물리적 병목으로 표출된다 (surface가 느려 injection-1이 blocked가 되는 시나리오).
//
// ▶ 라이프사이클 (상태 머신)
//   IDLE_AT_PICKUP   현재 레그의 픽업 station이 출력을 내놓길 대기.
//                    출력 발견 → takeOutput → 최소 체류 후 출발 조건 확인.
//                    출발 조건: 드롭 station이 입력 수용 가능. 충족 시 DELIVERY_MOVING.
//   DELIVERY_MOVING  현재 레그의 드롭 지점으로 이동. 도착 시 IDLE_AT_DELIVERY.
//   IDLE_AT_DELIVERY 드롭 station이 수용 가능해질 때까지 대기. addInput 후 최소 체류.
//                    체류 종료 시 — 마지막 레그면 RETURN_MOVING, 아니면 다음 레그(=IDLE_AT_PICKUP).
//   RETURN_MOVING    waypoints[0] 으로 복귀. 도착 시 IDLE_AT_PICKUP (legIndex=0).
//
//   ※ PICKUP_MOVING 은 사용하지 않는다. 초기 위치를 첫 픽업 지점에 두고,
//     멀티-레그 사이에서도 다음 픽업이 현재 위치와 동일하기 때문.
// ===================================================================

import * as THREE from 'three';
import { PART_COLORS, ROUTES, AGV } from './config.js';

const STATE = {
  IDLE_AT_PICKUP:   'idle-at-pickup',
  DELIVERY_MOVING:  'delivery-moving',
  IDLE_AT_DELIVERY: 'idle-at-delivery',
  RETURN_MOVING:    'return-moving',
};

// AGV 외형 상수 — 시연용 임시값. 추후 .glb 모델로 교체 시 사라짐.
const AGV_BODY_SIZE = { w: 1.0, h: 0.3, d: 1.0 };
const PART_INDICATOR_SIZE = { w: 0.5, h: 0.25, d: 0.5 };
const AGV_BODY_COLOR = 0x9CA3AF;
const PART_INDICATOR_Y = 0.35;   // AGV 중심에서 부품 표시까지
const PATH_LINE_Y = 0.05;        // 바닥 경로 점선의 y. 그리드(0.01)·바닥(0) 위.
const PATH_DIM_FACTOR = 0.6;     // 부품 색을 어둡게 만들어 바닥 마킹 느낌

/**
 * 단일 AGV.
 * Stage 3의 시간 기반 왕복에서 Stage 4의 큐 연동 멀티-레그 운반으로 재작성됨.
 * 시각적 표현(박스 본체·부품 점·바닥 경로)은 동일.
 */
export class AGVMarker {
  /**
   * @param {object} args
   * @param {THREE.Scene} args.scene
   * @param {object} args.route - ROUTES의 한 항목
   * @param {Object<string, object>} args.equipmentMap - id → equipment data (좌표 조회용)
   * @param {Map<string, import('./simulation.js').Station>} args.stations - id → Station (큐 조작용)
   */
  constructor({ scene, route, equipmentMap, stations }) {
    this.route = route;
    this.equipmentMap = equipmentMap;
    this.stations = stations;

    // 레그(leg): waypoints가 [A,B,C] 면 레그 2개 (A→B, B→C).
    // legIndex 는 현재 진행 중인 레그 인덱스. 픽업=waypoints[legIndex], 드롭=waypoints[legIndex+1].
    this.waypointPositions = route.waypoints.map((id) => this._getXZ(id));
    this.returnPosition = this._getXZ(route.returnTo);
    this.legCount = this.waypointPositions.length - 1;
    this.legIndex = 0;

    // ---------- AGV 본체 메쉬 ----------
    const bodyGeom = new THREE.BoxGeometry(
      AGV_BODY_SIZE.w, AGV_BODY_SIZE.h, AGV_BODY_SIZE.d
    );
    const bodyMat = new THREE.MeshStandardMaterial({
      color: AGV_BODY_COLOR,
      roughness: 0.7,
      metalness: 0.3,
    });
    this.mesh = new THREE.Mesh(bodyGeom, bodyMat);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;

    // 초기 위치: 첫 픽업 지점. 시작 상태는 IDLE_AT_PICKUP.
    const start = this.waypointPositions[0];
    this.mesh.position.set(start.x, AGV.hoverHeight, start.z);

    // ---------- 부품 표시 (AGV 윗면 작은 박스) ----------
    const partGeom = new THREE.BoxGeometry(
      PART_INDICATOR_SIZE.w, PART_INDICATOR_SIZE.h, PART_INDICATOR_SIZE.d
    );
    const partColor = PART_COLORS[route.partType];
    if (partColor === undefined) {
      throw new Error(`PART_COLORS에 '${route.partType}' 색상이 없습니다.`);
    }
    const partMat = new THREE.MeshStandardMaterial({
      color: partColor,
      roughness: 0.6,
      metalness: 0.1,
    });
    this.partIndicator = new THREE.Mesh(partGeom, partMat);
    this.partIndicator.position.set(0, PART_INDICATOR_Y, 0);
    this.partIndicator.castShadow = true;
    this.partIndicator.visible = false;
    this.mesh.add(this.partIndicator);

    scene.add(this.mesh);

    // ---------- 상태 변수 ----------
    this.state = STATE.IDLE_AT_PICKUP;
    this.waitTimer = 0;
    this.carriedPart = null;   // 운반 중 부품 객체 (없으면 null)
  }

  _getXZ(equipmentId) {
    const eq = this.equipmentMap[equipmentId];
    if (!eq) {
      throw new Error(`Equipment '${equipmentId}' (route ${this.route.id})를 찾을 수 없습니다.`);
    }
    return { x: eq.position.x, z: eq.position.z };
  }

  /** 현재 레그의 픽업 station 인스턴스. */
  _pickupStation() {
    return this.stations.get(this.route.waypoints[this.legIndex]);
  }

  /** 현재 레그의 드롭 station 인스턴스. */
  _dropStation() {
    return this.stations.get(this.route.waypoints[this.legIndex + 1]);
  }

  /**
   * 매 프레임 호출. deltaSeconds는 이미 timeScale 이 곱해진 시뮬레이션 시간.
   */
  update(deltaSeconds) {
    switch (this.state) {

      case STATE.IDLE_AT_PICKUP: {
        const from = this._pickupStation();

        if (!this.carriedPart) {
          // 1) 아직 픽업 전 — 출력 큐가 채워질 때까지 무한 대기 (큐 starvation)
          if (from && from.hasOutput()) {
            this.carriedPart = from.takeOutput();
            this.partIndicator.visible = true;
            this.waitTimer = AGV.pickupWaitTime;
          }
        } else if (this.waitTimer > 0) {
          // 2) 픽업 직후의 짧은 체류 (시각적 자연스러움)
          this.waitTimer -= deltaSeconds;
        } else {
          // 3) 출발 조건 확인 — 드롭 지점이 수용 가능해야 출발.
          //    수용 불가면 여기서 계속 대기 (AGV가 fromStation 옆에 정체).
          const to = this._dropStation();
          if (to && to.canAcceptInput(this.carriedPart.type)) {
            this.state = STATE.DELIVERY_MOVING;
          }
        }
        break;
      }

      case STATE.DELIVERY_MOVING: {
        const target = this.waypointPositions[this.legIndex + 1];
        if (this._moveTowards(target, deltaSeconds)) {
          this.state = STATE.IDLE_AT_DELIVERY;
          this.waitTimer = 0;
        }
        break;
      }

      case STATE.IDLE_AT_DELIVERY: {
        const to = this._dropStation();

        if (this.carriedPart) {
          // 1) 아직 드롭 전 — 수용 가능해질 때까지 대기 (큐 blocking)
          if (to && to.canAcceptInput(this.carriedPart.type)) {
            to.addInput(this.carriedPart);
            this.carriedPart = null;
            this.partIndicator.visible = false;
            this.waitTimer = AGV.dropoffWaitTime;
          }
        } else if (this.waitTimer > 0) {
          // 2) 드롭 직후의 짧은 체류
          this.waitTimer -= deltaSeconds;
        } else {
          // 3) 다음 단계로 전이.
          //    마지막 레그면 RETURN_MOVING, 아니면 다음 레그 픽업 위치(=현재 위치)에서 대기.
          if (this.legIndex >= this.legCount - 1) {
            this.legIndex = 0;
            this.state = STATE.RETURN_MOVING;
          } else {
            this.legIndex += 1;
            this.state = STATE.IDLE_AT_PICKUP;
            this.waitTimer = 0;
          }
        }
        break;
      }

      case STATE.RETURN_MOVING: {
        if (this._moveTowards(this.returnPosition, deltaSeconds)) {
          this.state = STATE.IDLE_AT_PICKUP;
          this.waitTimer = 0;
        }
        break;
      }
    }
  }

  /**
   * 리셋 시 호출: 상태·위치를 처음 상태로 복귀시킨다 (메쉬 자체는 재사용).
   */
  reset() {
    const start = this.waypointPositions[0];
    this.mesh.position.set(start.x, AGV.hoverHeight, start.z);
    this.state = STATE.IDLE_AT_PICKUP;
    this.legIndex = 0;
    this.waitTimer = 0;
    this.carriedPart = null;
    this.partIndicator.visible = false;
  }

  /**
   * 씬 정리용: 메쉬·재질을 해제. 현재 리셋 시에는 reset()으로 충분하므로 미사용.
   */
  dispose(scene) {
    if (this.mesh.parent) this.mesh.parent.remove(this.mesh);
    else scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    this.partIndicator.geometry.dispose();
    this.partIndicator.material.dispose();
  }

  /**
   * AGV를 target(XZ평면)으로 deltaSeconds만큼 직선 이동.
   * @returns {boolean} 이번 프레임에 target에 도달했으면 true
   */
  _moveTowards(target, deltaSeconds) {
    const px = this.mesh.position.x;
    const pz = this.mesh.position.z;
    const dx = target.x - px;
    const dz = target.z - pz;
    const dist = Math.hypot(dx, dz);
    const step = AGV.speed * deltaSeconds;

    if (dist <= step || dist < 1e-6) {
      this.mesh.position.x = target.x;
      this.mesh.position.z = target.z;
      return true;
    }
    this.mesh.position.x += (dx / dist) * step;
    this.mesh.position.z += (dz / dist) * step;
    return false;
  }
}

// ---------- 바닥 점선 경로는 한 번만 그린다 (정적) ----------
let _pathLinesBuilt = false;

/**
 * ROUTES를 순회하며 AGV들 + 바닥 점선 경로를 씬에 추가한다.
 * 바닥 점선은 모듈 레벨 플래그로 보호되어 리셋 시 중복 생성되지 않는다.
 * @param {THREE.Scene} scene
 * @param {Object<string, object>} equipmentMap - id → equipment data
 * @param {Map<string, import('./simulation.js').Station>} stations - id → Station
 * @returns {AGVMarker[]}
 */
export function buildAGVs(scene, equipmentMap, stations) {
  if (!_pathLinesBuilt) {
    _buildRoutePaths(scene, equipmentMap);
    _pathLinesBuilt = true;
  }

  const agvs = [];
  for (const route of ROUTES) {
    agvs.push(new AGVMarker({ scene, route, equipmentMap, stations }));
  }
  return agvs;
}

/**
 * 모든 AGV의 위치·상태를 갱신.
 * timeScale은 main.js에서 이미 곱해진 simDelta를 전달받는다.
 * @param {AGVMarker[]} agvs
 * @param {number} deltaSeconds - 시뮬레이션 시간 기준 경과
 */
export function updateAGVs(agvs, deltaSeconds) {
  for (const agv of agvs) {
    agv.update(deltaSeconds);
  }
}

// ---------- 바닥 점선 경로 (한 번만 호출) ----------
function _buildRoutePaths(scene, equipmentMap) {
  for (const route of ROUTES) {
    const points = route.waypoints.map((id) => {
      const eq = equipmentMap[id];
      return new THREE.Vector3(eq.position.x, PATH_LINE_Y, eq.position.z);
    });
    const geom = new THREE.BufferGeometry().setFromPoints(points);

    const color = new THREE.Color(PART_COLORS[route.partType]);
    color.multiplyScalar(PATH_DIM_FACTOR);

    const mat = new THREE.LineDashedMaterial({
      color,
      dashSize: 0.5,
      gapSize: 0.3,
    });
    const line = new THREE.Line(geom, mat);
    line.computeLineDistances();
    scene.add(line);
  }
}
