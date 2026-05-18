// ===================================================================
// 모든 수치 상수·색상 상수를 한 곳에 모은다.
// - 사양(공장 크기, 카메라 거리 등)을 한눈에 보고 조정하기 위함
// - 이후 단계에서 장비·자재 색상, 시뮬레이션 파라미터도 여기에 추가될 예정
// ===================================================================

// 공장 크기 (단위: m)
// X축이 라인 흐름 방향(서→동), Z축이 라인 폭 방향(북→남)
export const FACTORY = {
  width: 60,      // X축, 라인 흐름 방향
  depth: 40,      // Z축, 라인 폭 방향
  wallHeight: 3,  // 외곽 벽 높이
  wallThickness: 0.2,
};

// 카메라 초기 상태 (비스듬한 상부 시점)
export const CAMERA = {
  initialPosition: { x: 45, y: 35, z: 45 },
  fov: 60,
  near: 0.1,
  far: 300,
  minDistance: 15,
  maxDistance: 120,
};

// 색상 팔레트
// CSS의 다크 테마와 톤을 맞춤. CSS 변수가 아니라 Three.js용 16진 숫자.
export const COLORS = {
  bgCanvas: 0x0f1419,
  floor: 0x2a2f3a,
  gridMajor: 0x3a4050,
  gridMinor: 0x2a3038,
  wall: 0x353b47,
  ambientLight: 0xffffff,
  directionalLight: 0xffffff,
};

// 조명 강도·위치
export const LIGHTING = {
  ambientIntensity: 0.35,
  directionalIntensity: 0.75,
  directionalPosition: { x: 50, y: 60, z: 30 },
  shadowMapSize: 2048,
  shadowCamera: {
    left: -40,
    right: 40,
    top: 30,
    bottom: -30,
    near: 0.5,
    far: 200,
  },
};

// OrbitControls 제한
export const CONTROLS = {
  dampingFactor: 0.08,
  minPolarAngle: 0.15,                // 거의 수평 시점은 허용하되 완전 수평은 막음
  maxPolarAngle: Math.PI / 2 - 0.1,   // 카메라가 지하(바닥 아래)로 내려가지 못하게 함
};

// ===================================================================
// 장비 배치 데이터
// - 모든 박스 색상·크기·좌표를 여기에 모은다.
// - 추후 사실적 .glb 모델로 교체할 때는 같은 id·position을 그대로 쓰고
//   meshFactory만 바꾸면 되도록 데이터/렌더링을 분리한다.
//
// 좌표계:
//   X축: 라인 흐름 방향 (0 → 60, 서→동)
//   Y축: 높이 (0이 바닥, 박스 중심 = 높이/2)
//   Z축: 라인 폭 (-20 ~ +20, 북→남)
//
// type:     'injection' | 'surface' | 'assembly' | 'shipping' | 'supply'
// partType: 'lens' | 'bezel' | 'housing' | null
// ===================================================================
export const EQUIPMENT = [
  {
    id: 'injection-1',
    name: '사출기 #1\n(렌즈)',
    type: 'injection',
    position: { x: -20, y: 1.5, z: 12 },
    size: { w: 4, h: 3, d: 4 },
    color: 0x7DB7C4,
    partType: 'lens',
  },
  {
    id: 'injection-2',
    name: '사출기 #2\n(베젤)',
    type: 'injection',
    position: { x: -20, y: 1.5, z: 0 },
    size: { w: 4, h: 3, d: 4 },
    color: 0x5A5A5A,
    partType: 'bezel',
  },
  {
    id: 'injection-3',
    name: '사출기 #3\n(하우징)',
    type: 'injection',
    position: { x: -20, y: 1.5, z: -12 },
    size: { w: 4, h: 3, d: 4 },
    color: 0x3A5A8A,
    partType: 'housing',
  },
  {
    id: 'surface',
    name: '표면처리\n(렌즈)',
    type: 'surface',
    position: { x: -5, y: 1, z: 12 },
    size: { w: 6, h: 2, d: 3 },
    color: 0x7C5295,
    partType: 'lens',
  },
  {
    id: 'assembly',
    name: '조립 라인',
    type: 'assembly',
    position: { x: 12, y: 1, z: 0 },
    size: { w: 8, h: 2, d: 5 },
    color: 0xA08530,
    partType: null,
  },
  {
    id: 'shipping',
    name: '출하장',
    type: 'shipping',
    position: { x: 25, y: 0.15, z: 0 },
    size: { w: 4, h: 0.3, d: 4 },
    color: 0x4A7A4A,
    partType: null,
  },
  {
    id: 'supply',
    name: '전자부품\n공급',
    type: 'supply',
    position: { x: 12, y: 0.75, z: -15 },
    size: { w: 2, h: 1.5, d: 2 },
    color: 0xA04040,
    partType: null,
  },
];

// 장비 공통 렌더링 파라미터 (박스 시연용; 추후 .glb로 대체될 임시값)
export const EQUIPMENT_RENDER = {
  roughness: 0.6,
  metalness: 0.2,
  labelYOffset: 0.5,  // 박스 상단으로부터 라벨이 떠 있을 거리 (m)
};

// ===================================================================
// Stage 3: AGV·자재 흐름 관련 상수
// - 부품 색상은 라인별 식별성을 위해 명확히 구분
// - 라우트는 'pickup → (경유) → drop → returnTo' 순환 구조
// - 시간은 모두 초 단위, 거리는 모두 m
// ===================================================================

// 부품 종류별 색상 (AGV 위 부품 표시·바닥 경로 점선·향후 자재 마커에 공통 사용)
export const PART_COLORS = {
  lens:        0x7DB7C4,  // 하늘색
  bezel:       0xBFA980,  // 베이지 (사출기 #2 회색과 구분)
  housing:     0x1A3A6B,  // 짙은 파랑
  electronics: 0xC0392B,  // 빨강
  completed:   0xD4A017,  // 황금 (조립 완료품)
};

// AGV 운반 경로 정의
// - waypoints: 픽업 지점에서 시작해 드롭 지점까지 이어지는 장비 id 시퀀스
// - returnTo: 드롭 후 복귀할 장비 id (보통 픽업 지점과 동일)
// - 한 라우트당 AGV 1대가 배정된다.
export const ROUTES = [
  {
    id: 'lens-loop',
    partType: 'lens',
    waypoints: ['injection-1', 'surface', 'assembly'],
    returnTo: 'injection-1',
  },
  {
    id: 'bezel-loop',
    partType: 'bezel',
    waypoints: ['injection-2', 'assembly'],
    returnTo: 'injection-2',
  },
  {
    id: 'housing-loop',
    partType: 'housing',
    waypoints: ['injection-3', 'assembly'],
    returnTo: 'injection-3',
  },
  {
    id: 'electronics-loop',
    partType: 'electronics',
    waypoints: ['supply', 'assembly'],
    returnTo: 'supply',
  },
  {
    id: 'shipping-loop',
    partType: 'completed',
    waypoints: ['assembly', 'shipping'],
    returnTo: 'assembly',
  },
];

// AGV 공통 파라미터
export const AGV = {
  speed: 3.0,           // m/s
  pickupWaitTime: 2.0,  // 픽업 지점 대기 시간 (초)
  dropoffWaitTime: 2.0, // 드롭 지점 대기 시간 (초)
  hoverHeight: 0.3,     // 바닥에서 떠 있는 높이 (m, 박스 중심 기준)
};

// 시간 가속 — Stage 7에서 슬라이더로 조정 가능하게 확장 예정.
// updateAGVs(dt) 내부에서 dt × TIME_SCALE을 사용한다.
export const TIME_SCALE = 1.0;
