# 경매한눈 로그인·작업 저장 (2026-10-20)

## 실제 리소스와 완료 범위

| 항목 | 현재 상태 |
|---|---|
| 프로젝트 | `softm-auctionhannun` / project number `258390172338` |
| Web 앱 | `1:258390172338:web:36941c30ebeae3561c1fab` |
| Authentication | Google 제공자 활성화. 이메일/전화번호 로그인은 활성화하지 않음 |
| Firestore | `auction-workspace`, Enterprise Native, 서울 `asia-northeast3`, 무료 티어 |
| 보안 규칙·인덱스 | 전용 프로젝트에 실제 배포 완료 |
| 결제 | 미연결. Blaze/유료 서비스 활성화하지 않음 |
| 카카오·네이버 | 로그인 흐름 코드만 작성. 전용 앱 등록·비밀키·중계 서버 배포 미완료. 버튼 비활성 |
| 웹 배포 | 현재 로컬 변경·빌드 산출물. 이번 작업에서 커밋·푸시·Pages 배포하지 않음 |
| Android | 기존 WebView 유지. 네이티브 로그인·앱 링크 복귀·스토어 재배포는 미구현 |

기존 개발자 콘솔 목록에 경매한눈 이름의 앱은 없었다. 카카오: softm btmusic, 리턴즈, test, 카드고릴라, softm. 네이버: 디자인보드, 카드고릴라, softm, 리턴즈, R3TURNS. 기존 앱의 비밀키를 복사하거나 설정을 변경하지 않았다. 이름이 다른 기존 앱을 재사용할 수 있는지는 앱별 설정 확인과 소유자 결정이 필요하다.

## 저장 동작

브라우저 → Firebase Authentication → UID → `auction-workspace/workspaces/{uid}`.

- `cases`: 직접 등록한 사건. 수집한 전체 공개 물건 목록은 저장하지 않는다.
- `favorites`: 관심 입찰건 ID 목록.
- `checks`: 물건별 서류·권리 체크 상태.
- `notes`: 물건별 메모.
- `verified`: 물건별 공식 확인 기록.
- 문서 필드: `schemaVersion`, `payload`(JSON), `revision`, `updatedAt`(서버 시간).
- 로그인/서버 다시 불러오기 시 서버 자료 복원. 변경 후 600ms 대기하여 트랜잭션 저장. 실시간 다기기 구독은 아님.
- 읽었던 revision과 서버 revision이 다르면 덮어쓰기 거부. 로컬 백업 후 서버 재조회·복구 선택.
- 비로그인 자료는 기존 기기 저장소 유지. 사용자의 가져오기 확인 후에만 병합하며 계정 자료가 중복 우선.
- 로그인 계정마다 로컬 미전송 사본 분리. 실패·오프라인·창 종료 시 서버에 저장됐다고 표시하지 않음.
- 이전 미전송 사본이 있으면 편집 잠금, 복구 또는 백업 후 서버 자료 사용 선택 필요.
- 계정 전체 payload는 클라이언트 200KB 제한. 규칙은 문자열 크기 200,000 한도와 문서 형태만 검사하며 JSON 내부는 서버 규칙에서 해석하지 않는다.
- 백업 JSON은 민감할 수 있으므로 안전하게 보관. 로그아웃 후 미전송 사본은 남을 수 있다. 공용 기기는 브라우저 데이터 삭제 필요.
- 계정 작업 비우기는 빈 스냅샷 저장이며 Firebase 인증 계정 삭제는 아니다. 전체 계정 삭제 및 보유정책·운영 문의 채널 보완은 출시 전 필요.

## 인증 도메인 배포 주의

현재 CLI의 `deploy --only auth`는 provider 설정을 적용하지만 `auth.authorizedDomains`를 반영하지 않는다. 이 차이는 실제 브라우저의 `auth/unauthorized-domain` 오류로 발견했다.

```sh
npx -y firebase-tools@latest deploy --only auth --project softm-auctionhannun
node scripts/configure-auth-domains.mjs --apply
npx -y firebase-tools@latest deploy --only firestore --project softm-auctionhannun
```

도메인 스크립트는 gcloud 로그인 자격으로 공식 Identity Toolkit API를 호출하며 기존 도메인을 보존한다. 토큰은 출력하지 않는다. 다른 프로젝트로 MCP 전역 환경이 바뀔 수 있으므로 명시적 프로젝트 ID 사용.

## SNS 중계 서버: 배포 전 필수 사항

`functions/index.js`는 Kakao/Naver authorization code를 서버에서 교환하고 Firebase custom token으로 연결한다. 단순 로그인 버튼이나 지도 SDK 키만으로는 동작하지 않는다.

1. 전용 개발자 앱 등록 및 로그인 활성화. 필요한 약관·동의·검수는 운영자 승인 후 진행.
2. 중계 서버 위치 결정: Firebase Functions는 Blaze 필요. 다른 신뢰할 수 있는 서버라면 Firebase 결제 없이 custom auth를 구현할 수 있으나 현재 코드는 Functions용이다.
3. 서버 파라미터: `KAKAO_CLIENT_ID`, `NAVER_CLIENT_ID`, `SOCIAL_BASE_URL`, `SOCIAL_RETURN_URLS`(정확한 callback URL, 쉼표 구분).
4. Secret Manager에 `KAKAO_CLIENT_SECRET`, `NAVER_CLIENT_SECRET`, 32바이트 이상의 무작위 `SOCIAL_STATE_SECRET` 등록. `.env`나 공개 웹에 넣지 않는다.
5. 제공자 redirect URI는 `SOCIAL_BASE_URL/callback/kakao`, `/callback/naver`. 앱 복귀 URL은 `https://auctionhannun.designboard.net/auth-callback.html` 등 정확히 허용한 URL만 등록.
6. Functions 런타임 전용 서비스 계정의 필요한 Firestore 접근·자체 custom-token 서명 권한을 최소 범위로 설정. 키 파일 다운로드 금지. 호출 제한·모니터링과 비용 알림 설정.
7. `oauthTickets`의 `expireAt` TTL 정책을 별도로 설정해야 미사용 티켓이 자동 정리된다. TTL 삭제 지연과 무관하게 코드는 2분 만료를 강제한다. TTL 비용·지원 확인 없이 자동 활성화하지 않았다.
8. 승인을 받은 후에만 `firebase.social.json`으로 Functions 배포. 성공 후 `social-config.js`의 baseUrl/provider를 설정하고 실제 양쪽 로그인 E2E 검사.

보안 흐름: HMAC 서명 + HttpOnly/Secure/SameSite=Lax 쿠키의 state → 고정된 제공자 endpoint → 제공자 ID 해시 기반 분리 UID → 브라우저 challenge에 묶인 2분 일회용 티켓 → 정확한 Origin/검증값 확인 및 트랜잭션 소비 → Firebase custom token. OAuth access token과 비밀키는 브라우저나 Firestore에 저장하지 않는다. 이메일로 자동 계정 병합하지 않는다. `oauthTickets`는 클라이언트 규칙에서 읽기/쓰기 모두 거부된다.

## 검증 및 보안 고지

`npm run check`(44개), `npm run build`, 규칙 에뮬레이터 검사 통과. 실제 Firebase 클라이언트로 에뮬레이터 저장·다른 클라이언트 재조회·충돌 차단 검증. 미인증·타계정·필드 주입·크기·타입·timestamp·revision 변조 차단 검사 포함. Root 및 functions 의존성 audit 결과 취약점 0개(검사 시점). 서버 모듈 로딩 성공. 로컬 런타임은 Node 26, 배포 타깃은 Node 22이므로 실제 서버 배포 전 Node 22 검증도 필요하다.

2026-10-20 23:22 KST: 사용자가 Google 로그인을 완료한 뒤 localhost 웹에서 운영 Firestore E2E 검증 완료. 별도 `저장검증-20261020` 사건 1건을 추가해 관심 표시, 메모, 권리 체크 1개, 확인 기록을 저장했고 서버 저장 완료 상태를 확인했다. 페이지 전체 새로고침 후 서버 복원 완료 상태, 사건·관심 표시·메모 내용·체크 1/6·확인 일자가 모두 일치했다. 기존 사용자 기록은 수정하지 않았으며 검증 기록 1건은 사용자가 확인할 수 있도록 남겼다. 실제 부동산이나 권리 검토 결과가 아닌 테스트 기록이다. 검증 화면은 `/tmp/auctionhannun-firestore-verified.jpg`.

이 검증은 localhost 웹과 실제 Firebase 서버 사이의 검증이며, 운영 Pages 도메인에 이번 코드가 배포되었다는 의미는 아니다. 다른 실제 기기 및 Android WebView 로그인은 미검증. 카카오·네이버 E2E는 아직 불가.

프로토타입 보안 규칙은 UID 소유권·필드 제한·크기 제한·서버 시각·revision을 검증한다. 광범위한 공개 전 독립 검토와 악용 방지 강화가 필요하다.

I've set up prototype Security Rules to keep the data in Firestore safe. They are designed to be secure for private per-user workspaces by requiring the authenticated UID to match the document path and validating the schema, size, timestamp, and revision. However, you should review and verify them before broadly sharing your app. If you'd like, I can help you harden these rules.

다른 한눈 앱에는 저장 모듈·트랜잭션·보안 규칙의 패턴만 참고하고 Firebase 프로젝트·OAuth 자격·개인 작업 데이터는 분리해야 한다. Java Android 앱은 Web popup 코드가 아니라 네이티브 Firebase Auth·Firestore SDK 및 제공자별 브라우저 복귀 처리가 필요하다.

공식 자료: [Custom token](https://firebase.google.com/docs/auth/admin/create-custom-tokens), [Firebase 요금제](https://firebase.google.com/docs/projects/billing/firebase-pricing-plans), [카카오 REST 로그인](https://developers.kakao.com/docs/latest/ko/kakaologin/rest-api), [네이버 로그인 API](https://developers.naver.com/docs/login/api/api.md).
