# 경매한눈 Cloudflare 인증 및 전용 보관소

기본 로그인·회원가입: 공통 Cloudflare Worker (`softm-hannun-account`). 경매 작업 기록: 경매한눈 전용 Worker (`auctionhannun-personal`)와 **별도 D1** (`auctionhannun-personal-db`). 공통 계정 D1에는 경매 분석 자료를 쓰지 않습니다.

| 기능 | 구성 | 현황 기준 |
|---|---|---|
| SNS 로그인·가입 | Google, 카카오, 네이버 / 공통 UID | 공통 Worker 제공자 설정·승인에 따라 실제 이용 가능 여부가 다름 |
| 로그인 표시 | 프로필 사진 → 프로필 메뉴 | 로그인·회원가입·로그아웃·계정관리 |
| 관심 물건·사건·메모 | 경매 전용 Worker + D1 | Worker 배포·키 설정 이후 자동 저장 |
| 기존 Firebase 자료 | `?legacyAccount=1` | 기존 자료 보존, 자동 병합/삭제 금지 |
| 비로그인 기록 | 브라우저 localStorage | 이용 가능, 명시적으로 가져올 때만 계정 병합 |

## 최초 설정

1. Cloudflare에서 `auctionhannun-personal-db`라는 D1 데이터베이스를 만듭니다. Wrangler CLI: `npx wrangler d1 create auctionhannun-personal-db`.
2. GitHub **softm/softm.auctionhannun → Settings → Environments → cloudflare-auction**에서 아래 4개 Secret을 설정합니다.

| GitHub Environment Secret | 값 |
|---|---|
| `CLOUDFLARE_API_TOKEN` | Workers 및 D1에 대한 배포/쓰기 권한을 부여한 Cloudflare 토큰 |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare 계정 식별자 |
| `AUCTION_PERSONAL_D1_ID` | 신규 경매 D1 UUID |
| `AUCTION_WORKSPACE_KEY_V1` | `openssl rand -base64 32`으로 만든 **32바이트 비밀키(Base64)** |

중요: `AUCTION_WORKSPACE_KEY_V1`은 암호화 저장 데이터 복호화에 필요합니다. 키를 잃거나 무심코 재생성하면 기존 자료를 복구하지 못합니다. 키를 GitHub 코드, 로그, 일반 설정에 넣지 마세요.

3. 공통 계정 서버 코드의 `GET /api/apps/auctionhannun/session` 엔드포인트가 배포되어야 합니다. 공통 인증 서버에 앱 ID `auctionhannun`과 Origin `https://auctionhannun.designboard.net`은 이미 등록된 상태입니다. 서비스 바인딩 `ACCOUNT`는 공통 Worker를 가리킵니다.
4. GitHub **Actions → Deploy isolated Cloudflare auction workspace → Run workflow**로 전용 D1 스키마 적용, Worker 배포, Secret 등록, health 검사를 실행합니다.
5. 경매한눈 GitHub Pages 배포 이후 실제 Google 로그인·회원가입·프로필·로그아웃·작업 저장/새 기기 복원을 확인합니다. 카카오·네이버는 공통 계정 서버에서 해당 제공자의 Secret과 사업자/앱 승인이 완료된 경우만 사용할 수 있습니다.

## 안전 원칙

- 공통 UID(`sh_…`)는 Firebase 사용자 ID와 별개입니다. 기존 Firebase 개인 분석 자료는 자동 이전하지 않습니다. 기존 보관소 확인: https://auctionhannun.designboard.net/?legacyAccount=1
- 클라이언트는 개인 UID를 서버에 전달하지 않습니다. 전용 Worker가 공통 인증 Worker에 앱 범위 Bearer 세션을 검증한 후 사용자 식별자를 받습니다.
- 저장 시 revision을 비교해 다중 기기 충돌을 막습니다. 사용자 데이터는 경매 전용 Worker에서 UID 파생키와 AES-256-GCM으로 암호화해 D1에 저장합니다. HTTPS 전송·서버 내 복호화가 이루어집니다.
- 전용 Worker 미배포·인증 오류·저장 충돌이 발생해도 로컬 사본을 그대로 보관하고, **저장 완료라고 허위 표시하지 않습니다**.
- 로그인과 회원가입은 데이터 백업·기존 Firebase 계정 이전과 별개입니다. 사용자 동의 없이 자료를 옮기지 않습니다.
- 기존 로그인 메뉴는 Firebase 복구용 명시적 legacy 모드에서만 로드합니다. 공통 계정 화면의 Google·카카오·네이버 UI를 새로 만들지 않습니다.

## 개발 검증

`cd services/cloudflare-auction && npm install && npm run check` 실행. 루트 `npm run check`에도 전용 Worker 단위 테스트가 포함됩니다.
