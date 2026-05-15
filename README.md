# Factory Simulator

가상의 사출 + 후공정 조립 공장을 3D로 시뮬레이션한다. JIPM 기준 OEE 분석 대시보드 포함.

## 라인 구성
사출기 #1 (렌즈) → 표면처리 → 조립
사출기 #2 (베젤) → 조립
사출기 #3 (하우징) → 조립
[전자부품 외부 공급] → 조립 → 출하

## 진행 단계 (MVP)

- [x] Stage 0+1: 셋업 + 공장 외곽
- [ ] Stage 2: 장비 배치
- [ ] Stage 3: AGV·자재 마커
- [ ] Stage 4: 시뮬레이션 엔진
- [ ] Stage 5: KPI 계산
- [ ] Stage 6: 대시보드 UI
- [ ] Stage 7: 이벤트 + 시연 완성

## 로컬 미리보기
`python -m http.server 8000` 후 `http://localhost:8000` 접속.

## 라이브
https://onyoupark.github.io/factory-simulator/
