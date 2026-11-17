# 목표
T04 주가 정보판의 js/replay.js 입력 검증 강화 기능 하나를 완성한다. 고정 검사 10개와 상한은 docs/t05/PLAN.md에 있다. B는 A와 다른 서비스/모델의 무료 새 세션에서 저장소와 이 원본 문서만 받는다. 이전 대화는 제공하지 않는다. 공통 상한은 30분·사용자 작업 요청 5회다.

# 현재 상태
A는 시간값 검증을 수정했다. source_time=null은 허용하고 숫자, null 조회시각, 불가능한 날짜, 시간대 없는 값은 거부한다. 형식은 대문자 T/Z, 초 필수, 선택적 소수 초, Z 또는 ±HH:MM이다. 윤초는 지원하지 않는다.

시작 소스: https://github.com/JIeeeUI/total/commit/57d5380a2c6fd12859acf2273ae1e3293825c4a4
A 종료 코드 버전: https://github.com/JIeeeUI/total/commit/0176b7c7b7d9fa18ff28d12411eaf41019c2df05
브랜치: t05/input-validation-a
검사 SHA256: 30702f4491507ba48f43d286e145ac09aa50353ce427d6c776e44f704649b781

A 종료 코드 커밋 이후에는 결과·문서만 추가된다. 최신 문서 커밋의 HEAD가 위 코드 버전과 달라도 js/replay.js와 고정 검사 내용은 동일해야 한다. B는 받은 문서 커밋 ID도 별도로 기록하고, 작업 시작 커밋은 문서까지 포함된 실제 체크아웃 버전으로 남긴다. 과거 로컬 평가 예제 수정 결과는 이번 실행에 합산하지 않았다.

# 실행 명령
Node.js 24 이상을 사용한다. 외부 패키지 설치, API 키, 환경변수 설정이 필요 없다. 저장소 루트에서 실행한다.

```sh
node --version
node tests/t05-fixed-validation.cjs
node scripts/test-replay.js
```

두 번째 명령은 고정 검사 JSON을 출력한다. 현재 7 PASS/3 FAIL 및 종료 코드 1이 정상적인 인계 상태다. 최종 B 완료 때는 10 PASS/0 FAIL 및 종료 코드 0이어야 한다. 세 번째 명령은 기존 회귀 검사이며 종료 코드 0이어야 한다. 가격 수집 명령 npm run fetch는 이 검사를 위해 실행하지 않는다.

새 폴더 재현:
```sh
git clone --branch t05/input-validation-a https://github.com/JIeeeUI/total.git t05-check
cd t05-check
node tests/t05-fixed-validation.cjs
```

# 통과 검사
V01~V07이 PASS다. 기존 정상·갱신·5종 실패 보존·복구와 정상 시간 형식을 유지하고 잘못된 시간값을 거부한다. 기준 실행은 3/10, 수정 후와 새 폴더 재현은 각각 7/10이다. evidence/t05/a/의 회차별 JSON 및 fresh-folder.json을 확인한다.

# 남은 문제
첫 실패 V08: source_name 121자가 거부되지 않는다. V09: unit 25자가 거부되지 않는다. V10: 숫자 signal_id가 정규식의 문자열 변환으로 수락된다. B는 source_name 최대 120자, unit 최대 24자, signal_id 문자열 타입을 validateNormalizedReading에 반영한다. 한 기능 안의 남은 작업이며 테스트를 바꾸지 않는다.

절차상 한계: 저장소 내 공통 작업 지시는 고정했지만 실제 A/B 대화의 최초 메시지가 문자 단위로 같았다는 증거는 아직 없다. B 무료 환경·모델 차이·사용자 플랫폼 시작 시각·사용자 본인 판단·최종 10/10·최종 공개 비교 보고서 완성은 확인 전이다. 충족했다고 표시하지 않는다.

# 다음 행동
1. 받은 원본 HANDOFF.md SHA256을 evidence/t05/a/handoff-sha256.txt와 비교한다. B 시작 시각·실제 모델/서비스 차이 및 무료 이용 여부·시작 커밋·검사 SHA256·실제 요청 수를 기록한다. A 이후 B 시작 순서를 지킨다.
2. 새 폴더에서 동일 검사 10개를 먼저 실행해 7/10을 재현한다. 문서 누락은 없음 또는 보완 전후로 기록한다. 보완이 필요하면 원본을 덮어쓰지 말고 별도 파일에 남긴다.
3. V08~V10을 수정하고 같은 검사 10개와 기존 회귀 검사를 실행한다. 모든 고정 검사 실행 회차를 보존하고 FAIL이 하나 이상인 회차를 오류 1회로 센다. 소스 종료 커밋·종료 시각·실제 요청 수를 보존하고 REPORT.md의 비교표를 실제 수치로 채운다. 재작업량은 수기로 작성하지 않는다.

# 건드리지 말 것
고정 검사 tests/t05-fixed-validation.cjs의 ID·입력·기대값, fixtures/, A 원본 인수인계·검사 결과·기록은 변경하지 않는다. index.html, css/, js/app.js, scripts/fetch-price.js, .github/, data/도 이번 개선 범위 밖이다. 외부 패키지·비밀값·개인정보·대화 전문은 추가하지 않는다. 실제로 수행하지 않은 B 실행·배포·사용자 판단을 작성하지 않는다. 공개 비교표의 모델/서비스 이름은 가린다.
