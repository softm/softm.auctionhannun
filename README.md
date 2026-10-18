# 경매한눈

`토지한눈`의 지도 중심 탐색과 바텀시트 UX를 참고해 만든 부동산 법원경매 검토 도구입니다.

- GitHub 저장소: `softm/softm.auctionhannun`
- 운영 주소: `https://softm.github.io/softm.auctionhannun/`

## 제공 기능

- 주소·사건번호·법원 통합 검색과 물건 유형 필터
- 관심 물건, 사용자 사건 추가, 최근 공식 확인 시각의 브라우저 저장
- 매각물건명세서·현황조사보고서·감정평가서 확인 체크리스트
- 권리분석과 현장조사 체크리스트, 물건별 메모
- 대한민국 법원경매정보, 인터넷등기소, 정부24, 찾기쉬운 생활법령 공식 연결
- 모바일 바텀시트와 데스크톱 2단 패널에 대응하는 반응형 UI

법원경매정보의 안정적인 공개 API를 전제로 하지 않습니다. 화면에 포함된 네 건은 기능 확인용 예시이며 실제 입찰 정보가 아닙니다. 사건의 최신 상태와 원문 서류는 공식 사이트에서 반드시 다시 확인해야 합니다.

## 자료수집과 배포 흐름

```text
검수 입력 또는 허용된 HTTPS JSON 피드
  → scripts/collect-auctions.mjs
  → 개인정보 패턴·필수값·출처 검증
  → data/auctions.json
  → 테스트·정적 빌드
  → GitHub Pages 배포
```

- `.github/workflows/collect-auctions.yml`: 매일 오전 6시 20분(한국시간) 자료 정규화 및 변경분 커밋
- `.github/workflows/deploy-pages.yml`: `main` 변경 시 검사·빌드 후 GitHub Pages 배포
- 외부 피드를 연결하려면 저장소 변수 `AUCTION_FEED_URL`에 HTTPS JSON 주소를 등록합니다.
- 변수가 없으면 `data/inbox.json`의 검수 데이터를 사용합니다.
- 공식 법원 사이트 HTML을 직접 크롤링하거나 CAPTCHA·WAF를 우회하지 않습니다.
- 소유자·임차인 성명, 연락처, 주민등록번호 등 개인정보는 수집 대상이 아닙니다.

## 실행

```bash
npm start
```

`http://127.0.0.1:4187`을 엽니다.

## 검증

```bash
npm run check
```

배포 산출물은 `npm run build`로 `dist/`에 생성합니다.
