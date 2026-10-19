# 경매 자료 관리

## 파일

- `inbox.example.json`: 빈 입력 양식. 예시 승인 상태는 false
- `auctions.json`: 법원경매 정규화 결과물 (공급원 미연결로 현재 0건)
- `onbid/`: 별도로 수집한 온비드 공식 공매 데이터. 법원 사건과 혼합하지 않음
- 각 데이터 디렉토리의 `catalog/<hash>.json.gz`: 브라우저가 한 번 읽는 검색 인덱스
- `details/<hash>.json`: 선택할 때 읽는 개별 상세
- `manifest.json`: 해시·건수·범위·공급 구분
- `collection-status.json`: 최근 시도·성공 시각과 실패 상태
- `sources.json`: 출처와 수집 정책

원본 응답과 체크포인트는 `source-data/`에만 보관하며 Git/Pages에서 제외합니다. 예시 4건은 `tests/fixtures/` 전용입니다. `scripts/build.mjs`는 현재 manifest가 가리키는 공개 정규화 파일만 배포합니다.

## 원칙

1. 사건번호·법원·소재지·매각기일 등 공개 사건 정보만 다룹니다.
2. 소유자나 임차인의 성명·연락처·주민등록번호 같은 개인정보를 넣지 않습니다.
3. 각 물건은 확인 가능한 `sourceUrl`을 가져야 합니다.
4. 공식 사이트의 WAF, CAPTCHA, 접근제한을 우회하지 않습니다.
5. 웹 화면은 공식 원문을 대체하지 않으며 입찰 전 최신 내용을 다시 확인합니다.
6. 법원 입력에는 `metadata.reviewed=true`, `redistributionAllowed=true`, `demo=false`, `datasetKind="court-auction"`, `coverage`, `snapshotId`, `expectedCount`를 명시합니다. 출처 허용과 검수를 확인한 사람이 설정해야 합니다.
7. 페이지 누락·중복 ID·전체 건수 불일치·오류 응답으로 기존 정상 목록을 덮어쓰지 않습니다. 갑작스러운 빈 목록도 자동 반영하지 않습니다.
8. 온비드 입찰건은 물건관리번호 + 공매조건번호 + 마감시각으로 식별합니다. 하나의 물건에 여러 일정이 있으므로 입찰건 수와 고유 물건 수를 구분합니다.
9. 좌표를 임의 생성하지 않습니다. 온비드의 원본 지번 코드는 표준 PNU로 단정하지 않으며, VWorld 후보를 사용자가 확인한 뒤 경계를 표시합니다.

`AUCTION_FEED_URL`을 연결할 때도 같은 JSON 구조를 사용해야 합니다. HTML 페이지를 피드 URL로 지정하면 수집기가 거부합니다.

로컬 검수 파일은 `npm run collect -- --input /검수/경로.json`, 온비드는 `ONBID_SERVICE_KEY`를 안전하게 환경에 설정한 뒤 `npm run collect:onbid`로 실행합니다. 브라우저는 수집용 키를 사용하지 않습니다. 자세한 범위·제한·공식 근거는 `docs/INTEGRATION.md`에 기록합니다.
