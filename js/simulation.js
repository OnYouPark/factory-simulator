// ===================================================================
// Stage 4: 시뮬레이션 엔진
//
// - 공정 1개당 Station 인스턴스 1개. STATION_SPECS의 id별로 생성한다.
// - 각 Station은 자체 입력/출력 큐와 사이클 타임 기반 처리 상태를 가진다.
// - AGV는 markers.js에서 이 Station 인스턴스를 직접 참조해 큐와 상호작용.
// - KPI 원천 데이터(가동 시간·정지 시간·생산 수량)는 Station.stats에 누적되며
//   Stage 5에서 대시보드가 이 값을 읽어 가공한다.
//
// 핵심 모델:
//   1. 사출/공급 station: 입력 큐 없음. 원료 무한 가정으로 사이클 타임마다
//      해당 partType 1개를 출력 큐에 push.
//   2. 표면처리/출하 station: 일반 FIFO 큐. 입력 큐에서 꺼내 처리 → 출력 큐.
//   3. 조립 station: 입력 큐가 4종(lens·bezel·housing·electronics) 별도.
//      4종이 모두 ≥1개 있을 때만 사이클 시작, 완료 시 'completed' 부품 1개 출력.
//   4. 출력 큐가 가득 → status = 'blocked' (사출기 정지)
//      입력이 부족 → status = 'starved' (다음 공정 대기)
// ===================================================================

import { STATION_SPECS } from './config.js';

/**
 * 단일 공정을 모델링하는 Station 클래스.
 * status는 시각화(equipment.js)와 KPI 집계 양쪽에서 읽힌다.
 */
export class Station {
  constructor(id, spec) {
    this.id = id;
    this.type = spec.type;             // 'injection' / 'surface' / 'assembly' / 'shipping' / 'supply'
    this.partType = spec.partType;     // 'lens'·'bezel'·'housing'·'electronics' (injection/supply만)
    this.cycleTime = spec.cycleTime;
    this.defectRate = spec.defectRate;

    // ---------- 큐 구조 ----------
    // 조립은 4종 별도 입력 큐(객체), 사출·공급은 입력 큐 없음(null),
    // 그 외는 단일 FIFO 입력 큐(배열).
    if (this.type === 'assembly') {
      this.inputQueues = { lens: [], bezel: [], housing: [], electronics: [] };
      this.inputCapacity = spec.inputCapacity;
    } else if (this.type === 'injection' || this.type === 'supply') {
      this.inputQueues = null;
      this.inputCapacity = 0;
    } else {
      this.inputQueues = [];
      this.inputCapacity = spec.inputCapacity;
    }
    this.outputQueue = [];
    this.outputCapacity = spec.outputCapacity;

    // ---------- 처리 상태 ----------
    this.currentItem = null;
    this.processingProgress = 0;       // 누적 처리 시간 (초)
    this.status = 'idle';              // 'idle' | 'processing' | 'blocked' | 'starved'

    // ---------- KPI 원천 통계 ----------
    // 시뮬레이션 시간(초) 단위로 누적. Stage 5의 KPI 대시보드는 이 값을
    // 가공해 가동률·생산성·불량률 등을 계산한다.
    this.stats = {
      loadedTime: 0,    // 부하 시간 = 시뮬레이션 누적 시간 (전체 경과)
      operatingTime: 0, // 실제 가동 시간 (processing 누적)
      downTime: 0,      // 정지 시간 (blocked + starved 누적)
      producedCount: 0, // 처리 완료 총 수량 (양품 + 불량)
      goodCount: 0,     // 양품 수량
      defectCount: 0,   // 불량 수량
    };
  }

  /**
   * 매 시뮬레이션 프레임에 호출된다.
   * @param {number} deltaSeconds - 시뮬레이션 시간 기준 경과 (이미 timeScale 곱해진 값)
   */
  update(deltaSeconds) {
    this.stats.loadedTime += deltaSeconds;

    // 1) 현재 처리 중이면 진행도 누적, 완료되면 출력 큐로 이동
    if (this.status === 'processing') {
      this.processingProgress += deltaSeconds;
      this.stats.operatingTime += deltaSeconds;
      if (this.processingProgress >= this.cycleTime) {
        this.completeProcessing();
      }
    } else if (this.status === 'blocked' || this.status === 'starved') {
      this.stats.downTime += deltaSeconds;
    }

    // 2) idle/blocked/starved 상태에서는 매 프레임 사이클 시작을 재시도.
    //    (blocked·starved 도 조건이 풀리면 즉시 processing으로 전이될 수 있도록)
    if (this.status !== 'processing') {
      this.tryStartNextCycle();
    }
  }

  /**
   * 다음 사이클을 시작할 수 있는지 판정하고 시작 또는 적절한 정지 상태로 전이.
   * - 출력 큐가 가득 차 있으면 우선 blocked
   * - 입력이 부족하면 starved
   * - 모두 충족되면 processing 으로 전이
   */
  tryStartNextCycle() {
    // 출력 큐가 가득이면 시작 자체가 불가 → blocked
    if (this.outputQueue.length >= this.outputCapacity) {
      this.status = 'blocked';
      return;
    }

    if (this.type === 'injection' || this.type === 'supply') {
      // 사출·공급: 원료 무한, 출력 큐 여유만 있으면 즉시 시작
      this.currentItem = { type: this.partType, createdAt: this.stats.loadedTime };
      this.processingProgress = 0;
      this.status = 'processing';
    } else if (this.type === 'assembly') {
      // 조립: 4종 입력이 모두 있어야 함
      const parts = ['lens', 'bezel', 'housing', 'electronics'];
      const ready = parts.every((t) => this.inputQueues[t].length > 0);
      if (ready) {
        parts.forEach((t) => this.inputQueues[t].shift());
        this.currentItem = { type: 'completed', createdAt: this.stats.loadedTime };
        this.processingProgress = 0;
        this.status = 'processing';
      } else {
        this.status = 'starved';
      }
    } else {
      // surface / shipping: 단일 입력 큐
      if (this.inputQueues.length > 0) {
        this.currentItem = this.inputQueues.shift();
        this.processingProgress = 0;
        this.status = 'processing';
      } else {
        this.status = 'starved';
      }
    }
  }

  /**
   * cycleTime이 경과한 시점에 호출되어 양품/불량 판정 후 출력 큐로 이동.
   * 불량은 출력 큐에 들어가지 않고 폐기된다(통계에만 반영).
   */
  completeProcessing() {
    const isDefect = Math.random() < this.defectRate;
    this.stats.producedCount += 1;
    if (isDefect) {
      this.stats.defectCount += 1;
    } else {
      this.stats.goodCount += 1;
      // 출력 큐 push 시점에는 현재 아이템을 그대로 사용.
      // (출력 큐 용량은 tryStartNextCycle에서 이미 확인했으므로 안전)
      this.outputQueue.push(this.currentItem);
    }
    this.currentItem = null;
    this.processingProgress = 0;
    this.status = 'idle';   // 다음 프레임 update에서 곧장 tryStartNextCycle로 진입
  }

  /**
   * 외부(AGV)에서 이 station이 추가 입력을 받을 수 있는지 묻는다.
   * @param {string} partType - 추가하려는 부품의 종류
   * @returns {boolean}
   */
  canAcceptInput(partType) {
    if (this.type === 'assembly') {
      const q = this.inputQueues[partType];
      // 정의되지 않은 partType이면 받지 않음(안전).
      if (!q) return false;
      return q.length < this.inputCapacity;
    }
    if (this.type === 'shipping') return true;        // 출하장은 사실상 무제한
    if (this.type === 'injection' || this.type === 'supply') return false; // 입력 자체가 없음
    return this.inputQueues.length < this.inputCapacity;
  }

  /**
   * 외부(AGV)에서 이 station 입력 큐에 부품을 추가한다.
   * 호출 전 canAcceptInput으로 수용 가능 여부를 반드시 확인할 것.
   */
  addInput(part) {
    if (this.type === 'assembly') {
      this.inputQueues[part.type].push(part);
    } else {
      this.inputQueues.push(part);
    }
  }

  /** 출력 큐에 픽업 가능한 부품이 있는지. */
  hasOutput() {
    return this.outputQueue.length > 0;
  }

  /** 출력 큐 앞쪽 부품을 꺼낸다. 호출 전 hasOutput 확인 필수. */
  takeOutput() {
    return this.outputQueue.shift();
  }
}

/**
 * STATION_SPECS의 모든 항목으로 Station 인스턴스를 만들어 Map으로 반환.
 * - Map<id, Station>: AGV가 fromStation·toStation 참조 시 O(1) 조회.
 */
export function createStations() {
  const stations = new Map();
  for (const [id, spec] of Object.entries(STATION_SPECS)) {
    stations.set(id, new Station(id, spec));
  }
  return stations;
}

/**
 * 모든 Station의 update를 호출한다. 호출 순서는 의미 없음(각 Station은 독립).
 * @param {Map<string, Station>} stations
 * @param {number} deltaSeconds - 시뮬레이션 시간 기준 경과
 */
export function updateStations(stations, deltaSeconds) {
  for (const station of stations.values()) {
    station.update(deltaSeconds);
  }
}
