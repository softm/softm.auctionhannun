# 경매한눈 광고 운영 계획

## 채널 분리

| 실행 환경 | 광고망 | 적용 지면 | 상태 |
| --- | --- | --- | --- |
| 일반 웹·PWA | 카카오 AdFit | 목록 5번째 뒤 인피드, 접을 수 있는 하단 배너 | 경매한눈 전용 승인 단위 적용. 최초 진입 300×250은 배치 적합성 확인 전 요청 비활성 |
| Android WebView (네이티브 광고 비활성) | 카카오 AdFit | 승인 운영 URL의 웹 지면 | 웹과 동일한 접기·펼치기 동작 |
| Android WebView (네이티브 광고 활성) | Google AdMob | 앱 하단 앵커형 적응형 배너 | SDK·동의 흐름 적용, 운영 ID 발급 전 릴리스 비활성 |

네이티브 광고가 활성화된 Android만 `AdMobNative/1` 사용자 에이전트를 전달하며, 이때 웹의 AdFit 지면은 모두 숨긴다. 한 화면에서 두 광고망이 겹치지 않는다. 웹 광고 요청 중에는 지면 크기만큼 자리를 확보하고, 광고 없음·실패가 확인되면 해당 지면과 여백을 숨긴다. 목록 광고는 고정된 DOM을 유지하면서 앞뒤 물건 카드만 갱신해 iframe의 불필요한 재로드를 막는다. 2026-10-22 웹 개선의 세부 배치·승인 확인·검증 기준은 [AdFit 운영 문서](./ADFIT_SETUP.md)에 기록한다.

## Google 광고 적용 원칙

- `autorunnavi` 계열에서 확인한 운영/테스트 ID 분리와 노출 간격 관리 원칙을 따른다.
- 디버그 빌드는 Google 공식 테스트 App ID·배너 ID만 사용한다.
- 릴리스는 `android/admob.properties`에 경매한눈 전용 운영 ID를 넣고 `enabled=true`로 변경해야 활성화된다. 다른 앱의 광고 단위를 재사용하지 않는다.
- 앱 시작 때 UMP 동의 정보를 갱신하고 `canRequestAds()`가 참일 때만 Mobile Ads SDK를 초기화한다.
- 개인정보 옵션 재진입이 필요한 지역에서는 앱 내부 버튼을 자동 표시한다.
- 배너 로드 실패 시 영역을 숨긴다. 사용자의 콘텐츠 조작을 가리거나 광고 클릭을 유도하지 않는다.

## 전체화면 광고 판단

현 버전에는 전면·앱 오픈·보상형 광고를 넣지 않는다.

- 앱 오픈 광고는 로딩 화면이 없는 현재 WebView 구조에서 콘텐츠가 먼저 보인 뒤 광고가 튀어나올 가능성이 있다.
- 전면 광고를 검색·필터·체크리스트 작업 중 표시하면 예기치 않은 전면 광고가 될 수 있다.
- 보상형 광고와 교환할 유료 기능이 없어 사용자 기대와 맞지 않는다.

향후 전면 광고가 필요하면 상세 검토를 끝내고 목록으로 돌아오는 명확한 전환점에만 사전 로드하며, 최소 4시간 간격과 세션 1회 제한을 모두 적용한 별도 실험으로 진행한다.

## 운영 ID 적용

1. AdMob에서 패키지 `softm.realestate.auctionhannun`을 등록한다.
2. Android 앱 ID와 배너 광고 단위를 새로 발급한다.
3. `android/admob.properties.example`을 `android/admob.properties`로 복사한다.
4. `appId`, `bannerId`를 운영값으로 바꾸고 `enabled=true`로 설정한다.
5. UMP의 개인정보 보호 메시지를 AdMob 콘솔에서 게시한다.
6. 내부 테스트 트랙에서 실제 기기 테스트 후 Play 데이터 보안·광고 포함 여부를 다시 제출한다.

## 출시 전 체크리스트

- 테스트 ID 또는 다른 앱 광고 ID가 릴리스에 포함되지 않았는지 확인
- AdMob 콘솔에서 앱 승인과 `app-ads.txt` 상태 확인
- EEA·영국·스위스 테스트 지역에서 UMP 양식과 개인정보 옵션 확인
- 광고 로드 실패·오프라인·화면 회전 시 빈 여백이 남지 않는지 확인
- 개인정보처리방침과 Play 데이터 보안 답변이 실제 SDK 동작과 일치하는지 확인

## 공식 참고

- [Google Mobile Ads Android 시작](https://developers.google.com/admob/android/quick-start)
- [Google UMP Android 설정](https://developers.google.com/admob/android/privacy)
- [예기치 않은 전면 광고 금지 사례](https://support.google.com/admob/answer/6201362)
- [AdFit 운영 문서](./ADFIT_SETUP.md)
