# 경매한눈

Google Stitch 디자인을 적용한 부동산 경매·공매 검토 도구입니다. 법원경매와 온비드 공매를 구분하고, 실제 수집 자료의 출처·범위·마지막 수집 상태를 표시합니다.

- GitHub 저장소: `softm/softm.auctionhannun`
- 운영 주소: <https://auctionhannun.designboard.net/> (2026-10-22 HTTPS 접속 확인)

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

현재 법원경매는 대한민국 법원경매정보의 공개 물건상세검색을 17개 시·도로 분할해 전국 기본목록을 전 페이지 수집합니다. 각 지역의 `totalCnt`와 실제 수집 행수를 대조하고 전국 완주가 확인된 스냅샷만 배포합니다. 법원 사건·물건 상세는 약 1.7만 건을 미리 복제하지 않고, 사용자가 물건을 선택할 때 별도 Vercel Function이 공식 상세를 조회해 화면에 보강하며 성공 응답은 CDN 캐시합니다. DB는 사용하지 않습니다. 온비드 부동산·동산은 공식 API 기반 별도 데이터셋으로 유지합니다. 최신 상태·대상 범위·공고 원문은 공식 사이트에서 다시 확인해야 합니다.

상세 구조와 실제 연동·미연동 구분은 [수집·지도 연동 현황](docs/INTEGRATION.md)을 확인하세요. 2026-10-19 [GitHub Pages 배포](https://github.com/softm/softm.auctionhannun/actions/runs/39232000163)가 성공했고 [운영 사이트](https://softm.github.io/softm.auctionhannun/)에서 7,512입찰건·네이버 지도·주소 변환·지적도를 확인했습니다. Play Console 제출은 별개입니다.

지도 검증 상태: 로그인된 VWorld 콘솔에서 별도로 발급된 경매한눈 전용 키와 등록 URL `https://auctionhannun.designboard.net`, 검색·2D데이터 API 선택을 확인했습니다. 전용 키와 실제 `location.origin`을 적용했으며 등록되지 않은 외부 주소의 호출은 차단합니다. 개발키 만료일은 2027-04-19입니다. [수정 배포](https://github.com/softm/softm.auctionhannun/actions/runs/39235978516)는 성공했으나, 새 운영 도메인의 GitHub HTTPS 인증서가 발급 중이므로 **운영 필지 경계 성공은 아직 검증하지 못했습니다.** 로컬의 경계 요청도 이 전용 키로는 인증이 거부됐습니다. 기존 토지한눈·토지이용한눈의 키나 설정은 변경하지 않았습니다.

## 자료수집과 배포 흐름

```text
법원 전국 물건검색   → collect-court-list.mjs → data/
온비드 공식 API      → collect-onbid.mjs      → data/onbid/
  → 비공개 원본 gzip / 체크포인트
  → 출처·필수값·전체 페이지·개인정보 패턴 검증
  → 검색 gzip + 개별 상세 JSON + manifest / 수집 상태
  → 테스트·정적 빌드
  → GitHub Pages 배포
```

- `.github/workflows/collect-court-public.yml`: 매일 04:10 KST 법원 전국 기본목록 전수수집. 17개 시·도 전 페이지와 행수 일치를 검증한 경우에만 새 스냅샷을 반영합니다.
- `.github/workflows/collect-auctions.yml`: 매일 06:20 KST 온비드 공식 API 자료를 갱신합니다.
- `.github/workflows/deploy-pages.yml`: `main` 변경 시 검사·빌드 후 GitHub Pages 배포
- `.github/workflows/android-ci.yml`: Android 변경 시 API 36 린트와 debug APK 빌드
- 온비드는 GitHub Secret `ONBID_SERVICE_KEY`가 필요합니다. 키는 브라우저나 저장소에 넣지 않습니다.
- 법원 목록은 별도 API 키가 필요하지 않으며 공개 물건상세검색 JSON을 사용합니다. `ipcheck=false`, 403, 429 등 제한 신호가 나오면 우회하지 않고 수집을 중단하며 기존 정상 목록을 유지합니다.
- 법원 상세는 `softm-auctionhannun-api.vercel.app/api/court-detail`에서 클릭 시 조회합니다. DB 없이 브라우저 메모리 캐시와 CDN 캐시를 사용합니다.
- 검수 파일은 `npm run collect -- --input /절대/경로/검수.json`으로 명시적으로 지정할 수 있습니다. 구조·승인 조건은 [자료 관리](data/README.md)를 따릅니다.
- CAPTCHA·WAF를 우회하지 않습니다.
- 소유자·임차인 성명, 연락처, 주민등록번호 등 개인정보는 수집 대상이 아닙니다.

## 웹 광고와 상세자료 점검 (2026-10-22)

- 경매한눈 전용 AdFit 승인 단위로 하단 접기·펼치기와 목록 5번째 뒤 광고를 연결합니다. 돌봄한눈의 접힘 상태 보존·미수신 시 공간 반환 방식을 참고했습니다.
- 검색 입력·상세 검토·계정 및 사건 등록 대화상자에서는 광고를 숨깁니다. 최초 진입 팝업 광고는 배치 적합성 확인 전 실제 요청을 비활성화합니다.
- [광고 배치·발급 확인·검증 기준](docs/ADFIT_SETUP.md), [전체 광고 운영 계획](docs/ADVERTISING_PLAN.md)을 참고하세요.
- Android WebView 시작 주소와 내부 탐색 허용 호스트도 승인 운영 도메인으로 통일했습니다. 이 네이티브 변경은 새 Android 버전 설치 후 적용되며, 웹 배포만으로 기존 설치본의 시작 주소는 바뀌지 않습니다.
- 사진 갤러리, 사건 정보, 기일내역, 토지·건물 목록, 감정평가 요약, 공개문서 링크의 표시 구조는 구현돼 있습니다. 다만 2026-10-19 배포 스냅샷의 온비드 7,512입찰건에는 사진·추가 상세필드가 없고, 법원경매 공급원도 미연결 상태입니다. 표시 기능과 실제 수집 완료를 구분합니다.
- [데이터 수집 현황](https://auctionhannun.designboard.net/data-status.html)에서 정기 수집 예약, 배포 자료의 마지막 수집 시각, 사진 및 상세자료 제공 범위를 확인할 수 있습니다.

## Android / Google Play

- 프로젝트: `android/`
- 패키지: `softm.realestate.auctionhannun`
- 기기 표시명: `경매한눈`
- 버전: `1.0.2 (3)`
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
