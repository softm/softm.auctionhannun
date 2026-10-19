# 경매한눈

Google Stitch 디자인을 적용한 부동산 경매·공매 검토 도구입니다. 법원경매와 온비드 공매를 구분하고, 실제 수집 자료의 출처·범위·마지막 수집 상태를 표시합니다.

- GitHub 저장소: `softm/softm.auctionhannun`
- 등록 운영 주소: `https://auctionhannun.designboard.net/` (2026-10-19 HTTPS 인증서 발급 진행 중)

## 제공 기능

- 주소·사건번호·법원 통합 검색, 물건 유형·지역·법원 필터, 기일·최저가 정렬
- 관심 물건, 사용자 사건 추가, 최근 공식 확인 시각의 브라우저 저장
- 매각물건명세서·현황조사보고서·감정평가서 확인 체크리스트
- 권리분석과 현장조사 체크리스트, 물건별 메모
- 대한민국 법원경매정보, 인터넷등기소, 정부24, 찾기쉬운 생활법령 공식 연결
- 모바일 카드 목록·지도 전환·전체 화면 상세와 데스크톱 목록/지도 2단 반응형 UI
- 실제 저장된 관심 물건·직접 추가 사건·서류 확인 기록으로 계산하는 검토 현황
- 온비드 공식 API 목록, 별도의 공매 공고·명세·평가 체크리스트
- 네이버 실제 지도·주소 좌표 확인·지적도, VWorld 필지 후보와 PNU 일치 경계, 토지이음 원문 연결

2026-10-19 로컬 수집 결과: 온비드 7,512입찰건 / 물건관리번호 기준 4,466물건. 범위는 전국 압류재산·매각·수의계약 불가, 입찰기간 검색 10월 19~26일입니다. 전체 온비드 물건 수가 아닙니다. 법원경매 공급원은 아직 미연결(0건)입니다. 기존 예시 4건은 테스트 전용으로 이동했으며 오류 시 예시로 대체하지 않습니다. 최신 상태·대상 범위·공고 원문은 공식 사이트에서 다시 확인해야 합니다.

상세 구조와 실제 연동·미연동 구분은 [수집·지도 연동 현황](docs/INTEGRATION.md)을 확인하세요. 2026-10-19 [GitHub Pages 배포](https://github.com/softm/softm.auctionhannun/actions/runs/39232000163)가 성공했고 [운영 사이트](https://softm.github.io/softm.auctionhannun/)에서 7,512입찰건·네이버 지도·주소 변환·지적도를 확인했습니다. Play Console 제출은 별개입니다.

지도 검증 상태: 로그인된 VWorld 콘솔에서 별도로 발급된 경매한눈 전용 키와 등록 URL `https://auctionhannun.designboard.net`, 검색·2D데이터 API 선택을 확인했습니다. 전용 키와 실제 `location.origin`을 적용했으며 등록되지 않은 외부 주소의 호출은 차단합니다. 개발키 만료일은 2027-04-19입니다. [수정 배포](https://github.com/softm/softm.auctionhannun/actions/runs/39235978516)는 성공했으나, 새 운영 도메인의 GitHub HTTPS 인증서가 발급 중이므로 **운영 필지 경계 성공은 아직 검증하지 못했습니다.** 로컬의 경계 요청도 이 전용 키로는 인증이 거부됐습니다. 기존 토지한눈·토지이용한눈의 키나 설정은 변경하지 않았습니다.

## 자료수집과 배포 흐름

```text
승인 법원 JSON 피드 → collect-auctions.mjs → data/
온비드 공식 API     → collect-onbid.mjs    → data/onbid/
  → 비공개 원본 gzip / 체크포인트
  → 출처·필수값·전체 페이지·개인정보 패턴 검증
  → 검색 gzip + 개별 상세 JSON + manifest / 수집 상태
  → 테스트·정적 빌드
  → GitHub Pages 배포
```

- `.github/workflows/collect-auctions.yml`: 매일 오전 6시 20분(한국시간) 수집 후 `main` 기반 데이터 검토 PR 생성. 자동 병합하지 않음. `ONBID_SERVICE_KEY` 등록 및 첫 수동 실행 성공(2026-10-19). 최신 7,499입찰건 / 4,455물건은 [데이터 갱신 PR #3](https://github.com/softm/softm.auctionhannun/pull/3)에서 검토 후 반영하며, 현재 운영 스냅샷과 다릅니다.
- `.github/workflows/deploy-pages.yml`: `main` 변경 시 검사·빌드 후 GitHub Pages 배포
- `.github/workflows/android-ci.yml`: Android 변경 시 API 36 린트와 debug APK 빌드
- 온비드는 GitHub Secret `ONBID_SERVICE_KEY`가 필요합니다. 키는 브라우저나 저장소에 넣지 않습니다.
- 승인 법원 피드는 `AUCTION_FEED_URL`(Secret 권장), 필요 시 `AUCTION_FEED_TOKEN`을 등록합니다. 미설정 시 예시를 자동 수집하지 않습니다.
- 검수 파일은 `npm run collect -- --input /절대/경로/검수.json`으로 명시적으로 지정합니다. 구조·승인 조건은 [자료 관리](data/README.md)를 따릅니다.
- 공식 법원 사이트 HTML을 직접 크롤링하거나 CAPTCHA·WAF를 우회하지 않습니다.
- 소유자·임차인 성명, 연락처, 주민등록번호 등 개인정보는 수집 대상이 아닙니다.

## Android / Google Play

- 프로젝트: `android/`
- 패키지: `softm.realestate.auctionhannun`
- 기기 표시명: `경매한눈`
- 버전: `1.0.1 (2)`
- SDK: minSdk 24 / targetSdk 36 / compileSdk 36
- 개인정보처리방침: `https://softm.github.io/softm.auctionhannun/privacy.html`
- Play 등록 문구와 데이터 보안 기준: `android/store/`

로컬 `android/signing.properties`는 Git에서 제외됩니다. 서명 설정이 있는 환경에서 다음 명령으로 Play 업로드용 AAB를 생성합니다.

```bash
cd android
./gradlew lintRelease bundleRelease
```

산출물: `android/app/build/outputs/bundle/release/app-release.aab`

앱은 운영 GitHub Pages를 표시합니다. 변경 내용을 Pages에 배포·검증하고 지도 SDK의 실제 데이터 처리를 기준으로 Play 데이터 보안 항목을 재검토해야 합니다. 기존 `auctionhannun:*` 저장 키를 유지합니다. 이 작업에서는 Play Console 제출이나 출시를 수행하지 않았습니다.

## 실행

```bash
npm start
```

`http://localhost:3000`을 엽니다. 네이버 지도에 등록된 로컬 출처입니다. `file://`로 열면 모듈·자료를 정상적으로 읽을 수 없습니다.

Node.js 24 기준, 승인된 온비드 키를 환경변수로 설정한 뒤 `npm run collect:onbid`를 실행합니다. 기본 향후 7일이며 `ONBID_HORIZON_DAYS`는 1~31일입니다. `.env.example`은 설정 이름만 제공하며 실제 키는 커밋하지 않습니다.

## 검증

```bash
npm run check
```

배포 산출물은 `npm run build`로 `dist/`에 생성합니다.
