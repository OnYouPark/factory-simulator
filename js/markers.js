// ===================================================================
// Stage 3: AGV 마커 시스템 + 자재 흐름 시각화
//
// - 시각적 흐름이 우선. 실제 시뮬레이션 엔진(가동률·고장·큐잉 등)은 Stage 4.
// - AGV 5대가 ROUTES 정의에 따라 픽업→운반→드롭→복귀를 무한 반복한다.
// - 좌표는 equipment.js에서 만든 장비 데이터를 그대로 참조. 재정의 없음.
// - 외부 라이브러리 없음 (Three.js 기본만 사용).
// ===================================================================

import * as THREE from 'three';
import { PART_COLORS, ROUTES, AGV, TIME_SCALE } from './config.js';

// AGV 상태 상수. switch문 가독성·오타 방지를 위해 모아둠.
const STATE = {
  PICKUP_MOVING:   'pickup-moving',
  PICKUP_WAITING:  'pickup-waiting',
  DELIVERY_MOVING: 'delivery-moving',
  DROPOFF_WAITING: 'dropoff-waiting',
  RETURN_MOVING:   'return-moving',
};

// AGV 외형 상수 — 시연용 임시값. 추후 .glb 모델로 교체 시 사라짐.
const AGV_BODY_SIZE = { w: 1.0, h: 0.3, d: 1.0 };
const PART_INDICATOR_SIZE = { w: 0.5, h: 0.25, d: 0.5 };
const AGV_BODY_COLOR = 0x9CA3AF;
const PART_INDICATOR_Y = 0.35;   // AGV 중심에서 부품 표시까지 (AGV 윗면 0.15 + 부품 절반 0.125 ≒ 0.275, 살짝 띄움)
const PATH_LINE_Y = 0.05;        // 바닥 경로 점선의 y. 그리드(0.01)·바닥(0) 위.
const PATH_DIM_FACTOR = 0.6;     // 부품 색을 어둡게 만들어 바닥 마킹 느낌

/**
 * 단일 AGV 인스턴스.
 * 라이프사이클:
 *   PICKUP_MOVING → PICKUP_WAITING → DELIVERY_MOVING(반복) → DROPOFF_WAITING → RETURN_MOVING → (loop)
 *
 * 부품 표시(partIndicator) visible 규칙:
 *   - PICKUP_WAITING, DELIVERY_MOVING: 보임
 *   - PICKUP_MOVING, DROPOFF_WAITING, RETURN_MOVING: 숨김
 */
export class AGVMarker {
  /**
   * @param {object} args
   * @param {THREE.Scene} args.scene
   * @param {object} args.route - ROUTES의 한 항목
   * @param {Object<string, object>} args.equipmentMap - id → equipment data
   */
  constructor({ scene, route, equipmentMap }) {
    this.route = route;
    this.equipmentMap = equipmentMap;

    // 경로 좌표를 미리 한 번만 계산해 둠 (XZ 평면만 의미 있음).
    this.waypointPositions = route.waypoints.map((id) => this._getXZ(id));
    this.returnPosition = this._getXZ(route.returnTo);

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

    // 초기 위치: 첫 픽업 지점에 둠. PICKUP_MOVING 상태에서 첫 프레임에 곧장 도착 처리됨.
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
    // AGV 메쉬의 자식 → AGV가 움직이면 자동으로 따라간다.
    this.partIndicator.position.set(0, PART_INDICATOR_Y, 0);
    this.partIndicator.castShadow = true;
    this.partIndicator.visible = false;  // 시작은 픽업 이동 중이라 숨김
    this.mesh.add(this.partIndicator);

    scene.add(this.mesh);

    // ---------- 상태 ----------
    this.state = STATE.PICKUP_MOVING;
    this.currentWaypointIndex = 0;  // DELIVERY_MOVING 중 다음 도착 목표 인덱스
    this.waitTimer = 0;
  }

  _getXZ(equipmentId) {
    const eq = this.equipmentMap[equipmentId];
    if (!eq) {
      throw new Error(`Equipment '${equipmentId}' (route ${this.route.id})를 찾을 수 없습니다.`);
    }
    return { x: eq.position.x, z: eq.position.z };
  }

  /**
   * 매 프레임 호출. deltaSeconds는 이미 TIME_SCALE이 곱해진 값.
   */
  update(deltaSeconds) {
    switch (this.state) {

      case STATE.PICKUP_MOVING: {
        const target = this.waypointPositions[0];
        if (this._moveTowards(target, deltaSeconds)) {
          this.state = STATE.PICKUP_WAITING;
          this.waitTimer = AGV.pickupWaitTime;
          this.partIndicator.visible = true;  // 픽업 완료 = 부품 적재됨
        }
        break;
      }

      case STATE.PICKUP_WAITING: {
        this.waitTimer -= deltaSeconds;
        if (this.waitTimer <= 0) {
          // 다음 waypoint로 출발. 라우트가 waypoint 1개뿐이면 곧장 드롭으로.
          if (this.waypointPositions.length > 1) {
            this.currentWaypointIndex = 1;
            this.state = STATE.DELIVERY_MOVING;
          } else {
            this.state = STATE.DROPOFF_WAITING;
            this.waitTimer = AGV.dropoffWaitTime;
            this.partIndicator.visible = false;
          }
        }
        break;
      }

      case STATE.DELIVERY_MOVING: {
        const target = this.waypointPositions[this.currentWaypointIndex];
        if (this._moveTowards(target, deltaSeconds)) {
          const isFinal = this.currentWaypointIndex >= this.waypointPositions.length - 1;
          if (isFinal) {
            this.state = STATE.DROPOFF_WAITING;
            this.waitTimer = AGV.dropoffWaitTime;
            this.partIndicator.visible = false;  // 드롭 완료
          } else {
            // 경유 waypoint 통과 — 다음 인덱스로 갱신, 상태는 그대로 DELIVERY_MOVING 유지.
            this.currentWaypointIndex++;
          }
        }
        break;
      }

      case STATE.DROPOFF_WAITING: {
        this.waitTimer -= deltaSeconds;
        if (this.waitTimer <= 0) {
          this.state = STATE.RETURN_MOVING;
        }
        break;
      }

      case STATE.RETURN_MOVING: {
        if (this._moveTowards(this.returnPosition, deltaSeconds)) {
          // 한 사이클 종료 → 다시 픽업 이동으로
          this.state = STATE.PICKUP_MOVING;
          this.currentWaypointIndex = 0;
        }
        break;
      }
    }
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

    // 이번 프레임 이동 거리보다 남은 거리가 짧으면 정확히 target에 스냅.
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

/**
 * ROUTES를 순회하며 AGV 5대 + 바닥 점선 경로를 씬에 추가한다.
 * @param {THREE.Scene} scene
 * @param {Object<string, object>} equipmentMap - id → equipment data
 * @returns {AGVMarker[]} 생성된 AGV 인스턴스 배열 (애니메이션 루프에서 update에 전달)
 */
export function buildAGVs(scene, equipmentMap) {
  // 바닥 경로는 운반 경로(waypoints)만 그린다. 복귀 라인은 시각적 노이즈가 되므로 생략.
  _buildRoutePaths(scene, equipmentMap);

  const agvs = [];
  for (const route of ROUTES) {
    agvs.push(new AGVMarker({ scene, route, equipmentMap }));
  }
  return agvs;
}

/**
 * 모든 AGV의 위치·상태를 갱신.
 * @param {AGVMarker[]} agvs
 * @param {number} deltaSeconds - clock.getDelta() 원본 값 (TIME_SCALE은 여기서 곱한다)
 */
export function updateAGVs(agvs, deltaSeconds) {
  const dt = deltaSeconds * TIME_SCALE;
  for (const agv of agvs) {
    agv.update(dt);
  }
}

// ---------- 바닥 점선 경로 ----------
// LineDashedMaterial은 점선 표시를 위해 각 정점의 누적 거리가 필요하다.
// → BufferGeometry로 만든 뒤 line.computeLineDistances() 호출 필수.
function _buildRoutePaths(scene, equipmentMap) {
  for (const route of ROUTES) {
    const points = route.waypoints.map((id) => {
      const eq = equipmentMap[id];
      return new THREE.Vector3(eq.position.x, PATH_LINE_Y, eq.position.z);
    });
    const geom = new THREE.BufferGeometry().setFromPoints(points);

    // 부품 색을 60% 밝기로 어둡게 → 바닥 페인트 마킹 같은 느낌.
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
