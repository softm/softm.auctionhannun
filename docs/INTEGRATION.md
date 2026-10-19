# 경매한눈 수집·지도 연동 현황

확인일: 2026-10-19. 최초 Pages 배포와 기존 주소에서의 운영 화면 검증 후, [VWorld 전용 키 수정 배포](https://github.com/softm/softm.auctionhannun/actions/runs/39235978516)까지 완료했습니다. 새 등록 도메인의 HTTPS 인증서 발급과 운영 경계 검증은 아직 완료되지 않았습니다. Play Console 제출은 수행하지 않았습니다.

## 실제 구현

```text
법원경매: 승인 JSON 피드/검수 파일 (현재 미연결)
  └─ collect-auctions.mjs → data/ (법원경매 전용)
온비드: 공식 차세대 부동산 목록 API (실조회 성공)
  └─ collect-onbid.mjs → data/onbid/ (공매 전용)
       │
       ├─ source-data/ 원본 gzip + 회차별 checkpoint (비공개·Git/Pages 제외)
       ├─ auctions.json 정규화 원본
       ├─ catalog/<hash>.json.gz 검색용 인덱스
       ├─ details/<hash>.json 필요할 때 읽는 상세
       └─ manifest.json + collection-status.json
                    ↓ 검증 / 명시적 배포
              GitHub Pages → 웹 / Android WebView

사용자 목록 검색 → 로컬 인덱스 필터 (외부 검색 API 호출 없음)
주소 확인 버튼 → NAVER Geocoding → 실제 좌표 마커
지적도 버튼 → NAVER CadastralLayer
필지 찾기 → VWorld 주소 후보 → 사용자가 지번 확인
필지 경계 → 동일 PNU의 VWorld Polygon/MultiPolygon
토지이음 원문 → 같은 PNU로 공식 화면 열기
관심·메모·체크리스트 → 기기 로컬 저장만
```

돌봄한눈의 원본 보관, 목록/상세 분리, gzip 로더, 진행 중 요청 공유, 실패 캐시 제거, 최대 4개 주소 조회 방식을 경매 상황에 맞게 적용했습니다. 토지이용한눈의 주소 후보/PNU 일치 확인과 실제 필지 경계 표시 방식, 토지한눈의 VWorld 브라우저 키·실제 호스트명 전달 형식을 참고했습니다. 원본 프로젝트는 수정하지 않았습니다.

## 자료별 실제 상태

| 출처 | 제공·확인한 내용 | 상태 및 제약 |
|---|---|---|
| 대한민국 법원경매정보 | 사건·물건·기일·법원 서류 | 현재 직접 HTTP 요청에 WAF 차단. 우회하지 않음. 승인 피드·검수 파일 입력기는 구현했지만 실제 법원 물건은 0건 |
| 한국자산관리공사 온비드 | 물건관리번호, 공매조건번호, 물건명, 지역, 용도, 감정가, 공개 최저입찰가, 입찰기간, 상태, 면적, 원본 수정일 | 공식 API HTTP 200 / resultCode 00 확인. 최초 실제 수집 7,512입찰건, 물건관리번호 기준 4,466물건 |
| 등기정보광장 | 지역·기간·부동산 구분별 경매개시결정등기 등 통계 | 경매 검색 결과 20개 통계 API 확인. 개별 경매 물건·등기부 원문 대체용 아님. 서비스별 키가 필요해 아직 연동하지 않음 |

최초 온비드 범위: `prptDivCd=0007` 압류재산, `dspsMthodCd=0001` 매각, `pvctTrgtYn=N` 수의계약 불가, 입찰기간 검색 `20261019~20261026`. 전체 온비드·전체 법원경매 수라고 표시하면 안 됩니다. 같은 물건도 공매조건·마감일이 다르면 별도 입찰건입니다. 공고/기일/상태는 수집 후 변할 수 있습니다.

온비드 `ltnoPnu`에서 표준 PNU와 다른 산 구분 0/1 형식을 실제 관찰했습니다. 예: `산2-45` 물건의 원본 코드가 표준 PNU에서는 일반 토지를 뜻하는 1을 포함했습니다. 이 코드를 표준 PNU로 바로 열거나 임의 변환하지 않습니다. 현재는 VWorld 검색 후보의 확인된 PNU를 선택하여 경계를 조회합니다. 지적도는 법적 경계 확정·권리분석 자료가 아닙니다.

## 수집 운영

- 공식 온비드 주소: `https://apis.data.go.kr/B010003/OnbidRlstListSrvc2/getRlstCltrList2`
- 키는 `ONBID_SERVICE_KEY` 환경변수/GitHub Secret. 브라우저·소스·로그에 넣지 않습니다. 로컬 검증에서는 기존 돌봄한눈의 공공데이터 키를 프로세스 환경으로만 읽었습니다.
- 기본 향후 7일 범위, `ONBID_HORIZON_DAYS` 1~31일. 페이지 500건, 최대 100페이지 + 재확인 1회. 5xx/네트워크 오류는 요청당 최대 3회로 제한하므로 최악의 실제 HTTP 시도 수는 더 클 수 있습니다. 401/403/429는 즉시 중단합니다.
- 모든 페이지의 총건수 일치, 고유 입찰건 ID, 마지막 첫 페이지 재확인으로 도중 변경을 감지합니다. 서버의 트랜잭션 스냅샷 API는 아니므로 수집 시점 차이를 완전히 제거하지는 못합니다.
- 실패/빈 응답/예시 응답으로 기존 정상 목록을 덮어쓰지 않습니다. 갑작스러운 0건은 검토가 필요합니다.
- 원본과 완료 페이지 체크포인트는 로컬에 남습니다. 현재 재실행은 전체 지정 범위를 다시 조회합니다. 자동 이어받기/전국 영구 전체수집이 구현되었다고 표시하지 않습니다.
- 수집 원본에는 제공기관의 부가 필드가 포함될 수 있으므로 공개하지 않습니다. 배포는 명시적 허용 필드만 사용하는 정규화 자료입니다. 개인정보 패턴 검사는 이용권한·개인정보 검수를 대신하지 않습니다.
- `ONBID_SERVICE_KEY`는 사용자 승인 후 2026-10-19에 저장소 Actions Secret으로 등록했습니다. Actions의 매일 06:20 KST 예약이 `main`에 반영되었습니다. [첫 수동 실행](https://github.com/softm/softm.auctionhannun/actions/runs/39232063486)은 15페이지 / 7,499입찰건 / 4,455물건 검증에 성공하여 [갱신 PR #3](https://github.com/softm/softm.auctionhannun/pull/3)을 생성했습니다. 관련 변경만 부모 디렉토리별 날짜 접두어 커밋 → 데이터 검토 PR → 병합 후 Pages 순서이며 임의 자동 병합은 하지 않습니다. 현재 운영은 최초 7,512입찰건 스냅샷입니다. 매일 수집하는 것과 매일 운영 자료를 자동 교체하는 것은 다릅니다.
- 4개의 예시 자료는 `tests/fixtures`로 이동했습니다. 수집 실패 시 예시로 대체하지 않습니다.

## 지도와 사용자 정보

- `map-config.js`는 공개 브라우저 식별자만 포함하며 REST Secret은 없습니다. 사용자 로그인 후 VWorld 콘솔에서 별도로 발급된 **경매한눈 전용 키**, 웹사이트 유형, 등록 서비스 URL `https://auctionhannun.designboard.net`, 검색·2D데이터 API 선택을 확인했습니다. 전용 키의 발급일은 2026-10-19, 개발키 만료일은 2027-04-19입니다. 기존 토지한눈·토지이용한눈 키의 설정은 수정하지 않았고 운영키 신청도 하지 않았습니다.
- 요청의 `domain`은 실제 `location.origin`입니다. 등록 운영 origin 이외의 외부 주소는 API 호출 전에 명확한 안내로 차단합니다. 다른 서비스 도메인이나 Referer를 가장하지 않습니다. localhost는 개발 미리보기용 호출만 허용하지만, 현재 전용 키의 로컬 경계 응답은 `INCORRECT_KEY`였으므로 로컬 성공으로 기록하지 않습니다.
- GitHub Pages의 맞춤 도메인도 `auctionhannun.designboard.net`으로 설정되어 있음을 확인했습니다. 공개 DNS(Cloudflare·Google)는 `softm.github.io`를 반환했습니다. 권한 DNS의 일시적으로 다른 응답도 관찰했으며 후속 비재귀 조회에서는 두 서버가 같은 CNAME을 반환했습니다. GitHub 자체 검사는 `NotServedByPagesError`를 표시했고, 재검사 후 TLS `Certificate Requested`(1/3) 상태로 발급이 시작됐습니다. HTTPS 접속은 당시 `ERR_CERT_COMMON_NAME_INVALID`로 차단되어 **새 운영 도메인의 실제 필지 경계는 검증 대기**입니다. DNS 레코드 삭제·도메인 재등록·브라우저 보안 경고 우회는 수행하지 않았습니다.
- 지도는 사용자 요청 시 로드합니다. 주소/필지 확인 버튼을 누르면 해당 소재지 또는 PNU만 지도 제공자에게 전달합니다. 사건번호·메모·체크리스트는 전송하지 않습니다. 기기 GPS를 요청하지 않습니다.
- 주소 조회는 한 번에 최대 40건, 동시 4건, 성공 결과만 7일 캐시로 사용합니다. 주소 후보가 여러 개이거나 국내 좌표가 아니면 표시하지 않습니다.
- 좌표 없는 물건도 목록에서 제거하지 않습니다. 마커는 최대 500개로 제한하고 그 사실을 표시합니다. 목록은 40건씩 더 보기로 렌더링합니다.
- 온비드에는 법원 3대 서류/1주일 전 공시 안내를 적용하지 않고 별도 공매 공고·명세·평가 체크리스트를 보여줍니다.

## 검증과 남은 일

`npm run check` 27개 테스트 통과, `npm run build` 성공. `/tests/map-browser.html`은 로컬 실연동 확인 전용으로 배포에서 제외됩니다. 이전 토지한눈 키로는 실제 온비드 `2020-11444-007`의 세종시 와촌리 1084-4에 대해 주소 후보 `3611036031110840004`, 동일 PNU 토지이음 링크, 로컬 Polygon 표시를 확인했지만 이를 새 전용 키의 성공으로 간주하지 않습니다. 전용 키 변경 후에는 실제 origin 전달 및 다른 서비스·HTTP 운영 주소·유사 도메인 거부 회귀 테스트를 적용했습니다.

동일 실제 물건의 NAVER 주소 좌표·마커·지적도 표시, 법원 0건/공매 분리 필터, 목록 40→80건 더 보기를 로컬 브라우저에서 확인했습니다. Pages에서도 전체 7,512입찰건, 상세 JSON 로딩, NAVER 주소 변환·지도·지적도, VWorld 후보·동일 PNU 토지이음 링크를 확인했습니다. 운영 VWorld 경계 요청의 인증 오류는 별도로 기록합니다. 모바일 전용 크기 설정은 이번 도구에서 실제 뷰포트에 반영되지 않아 데스크톱 검증으로만 기록합니다. 모바일 실기기 검증은 별도로 필요합니다.

남은 일: GitHub의 도메인 검증·TLS 발급 완료 후 HTTPS 강제 및 새 운영 주소의 NAVER/VWorld 실연동 검증, 개발키 만료 전 연장 또는 운영키 전환, 데이터 갱신 PR 검토, 법원경매의 이용 가능한 별도 공급 경로 확보, 등기 통계 서비스별 키 신청(필요한 통계만), 지도 SDK가 포함된 실제 배포 기준으로 Play 데이터 보안 재검토. 현재 Play 심사 제출은 하지 않았습니다.

## 공식 근거

- [온비드 부동산 물건목록 API](https://www.data.go.kr/data/15157207/openapi.do): 현재 입찰/예정, 필수 재산구분·수의계약 여부, 매시간 갱신, 자동 승인, 개발계정 기본 1,000회 안내.
- [온비드 부동산 상세 API](https://www.data.go.kr/data/15157247/openapi.do): 물건관리번호/공매조건번호로 상세 조회. 이번에는 목록 응답의 공개 필드만 수집했고 상세 API는 호출하지 않았습니다.
- [온비드 물건상세 입찰정보 API](https://www.data.go.kr/data/15157251/openapi.do): 후속 공고별 입찰조건 확장 경로.
- [등기정보광장 API 안내](https://data.iros.go.kr/rp/oa/openOapiIntro.do), [API 목록](https://data.iros.go.kr/rp/oa/openOapiAppl.do): 회원·서비스별 인증키, 일 1,000건, 등기현황 통계.
- [NAVER 지도 지적도 공식 예제](https://navermaps.github.io/maps.js.ncp/docs/tutorial-2-cadastral.example.html).
- [VWorld 공식 API 예제](https://github.com/V-world/V-world_API_sample).
- [VWorld 공식 FAQ](https://www.vworld.kr/v4po_brdfaq_s001.do?bodIde=52): 웹사이트 유형의 키는 등록 서비스 URL과 domain 파라미터를 맞춰 사용하도록 안내합니다.
- [GitHub Pages HTTPS 안내](https://docs.github.com/en/pages/getting-started-with-github-pages/securing-your-github-pages-site-with-https): 도메인 DNS 검사 후 인증서 발급 절차가 진행됩니다. Actions 배포에서는 CNAME 파일이 필수가 아니므로 이를 임의로 추가하지 않았습니다([맞춤 도메인 문제 해결](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/troubleshooting-custom-domains-and-github-pages)).
