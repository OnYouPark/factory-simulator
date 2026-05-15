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
