import test from 'node:test';
import assert from 'node:assert/strict';
import { parcelAddressParts, selectParcelCandidate, parcelFeature, parcelScopeMessage } from '../parcel-utils.js';

const mountain = { pnu: '4136026221200240000', address: '경기도 남양주시 오남읍 양지리 산 24' };
const plain = { pnu: '4136026221100240000', address: '경기도 남양주시 오남읍 양지리 24' };
test('산24 and regular 24 remain distinct even when VWorld returns both', () => {
  assert.equal(selectParcelCandidate('경기도 남양주시 오남읍 양지리 산24', [plain, mountain]), mountain);
  assert.equal(selectParcelCandidate(plain.address, [mountain, plain]), plain);
  assert.throws(() => selectParcelCandidate(mountain.address, [plain]), /정확히 일치/);
  assert.throws(() => selectParcelCandidate(mountain.address, [{ ...mountain, pnu: plain.pnu }]), /정확히 일치/);
});

test('building labels are excluded, but lot subdivisions are not interchangeable', () => {
  const address = '강원특별자치도 횡성군 우천면 상대리 38 제1동호,제2동호,제3동호';
  const exact = { pnu: '5173031027100380000', address: '강원특별자치도 횡성군 우천면 상대리 38' };
  const similar = { pnu: '5173031027100380001', address: '강원특별자치도 횡성군 우천면 상대리 38-1' };
  assert.equal(parcelAddressParts(address).query, exact.address);
  assert.equal(selectParcelCandidate(address, [similar, exact]), exact);
  assert.throws(() => selectParcelCandidate(address, [similar]), /정확히 일치/);
  assert.equal(selectParcelCandidate('세종특별자치시 연서면 와촌리 1084-14', [{ pnu: '3611036031110840014', address: '세종특별자치시  연서면 와촌리 1084-14' }]).pnu, '3611036031110840014');
});

test('multi-parcel, unknown and ambiguous addresses never silently select a single boundary', () => {
  for (const address of ['전라남도 영암군 시종면 봉소리 7 (토지), 9 (토지, 건물)', '서울특별시 서초구 서초동 1487-110 외 1필지 에비앙하우스 제2층 제204호', '강원특별자치도 춘천시 남산면 방하리 202-2 , 202-15, 202-27']) {
    assert.equal(parcelAddressParts(address).multiple, true);
    assert.throws(() => selectParcelCandidate(address, [plain]), /여러 필지/);
  }
  assert.throws(() => selectParcelCandidate('주소 미정', [plain]), /정확히 일치/);
  const road = { ...plain, roadAddress: '서울특별시 중구 세종대로 110' };
  assert.equal(selectParcelCandidate('서울특별시 중구 세종대로 110 서울시청', [road]), road);
  assert.throws(() => selectParcelCandidate(road.roadAddress, [road, { ...road, pnu: mountain.pnu }]), /여러 개/);
});

test('missing boundaries, authentication errors and malformed or mismatched geometry are distinct', () => {
  const shape = { type: 'Feature', properties: { pnu: plain.pnu }, geometry: { type: 'Polygon', coordinates: [[[127,37],[127.01,37],[127.01,37.01],[127,37]]] } };
  const payload = features => ({ response: { status: 'OK', result: { featureCollection: { features } } } });
  assert.equal(parcelFeature(payload([shape]), plain.pnu), shape);
  assert.throws(() => parcelFeature(payload([shape]), mountain.pnu), /일치하는 유효한/);
  assert.throws(() => parcelFeature({ response: { status: 'NOT_FOUND' } }, plain.pnu), /경계 데이터가 없습니다/);
  assert.throws(() => parcelFeature({ response: { status: 'ERROR', error: { code: 'INCORRECT_KEY' } } }, plain.pnu), /INCORRECT_KEY/);
  assert.throws(() => parcelFeature(payload([{ ...shape, geometry: { type: 'Point', coordinates: [127,37] } }]), plain.pnu), /유효한 필지/);
});

test('an explicit primary lot can be shown only as a partial boundary, never a fuzzy match', () => {
  const address = '서울특별시 서초구 서초동 1487-110 외 1필지 에비앙하우스 제2층 제204호';
  const primary = { pnu: '1165010800114870110', address: '서울특별시 서초구 서초동 1487-110' };
  const other = { pnu: '1165010800114870111', address: '서울특별시 서초구 서초동 1487-111' };
  assert.throws(() => selectParcelCandidate(address, [primary]), /여러 필지/);
  const result = selectParcelCandidate(address, [other, primary], { allowPrimary: true });
  assert.equal(result.pnu, primary.pnu);
  assert.equal(result.partial, true);
  assert.equal(primary.partial, undefined);
  assert.equal(parcelAddressParts(address).key, primary.address);
  assert.match(parcelScopeMessage(address, result.address), /일부 필지만 표시.*1487-110.*다른 필지 미확인.*전체 경매 범위가 아닙니다/);
  assert.throws(() => selectParcelCandidate(address, [other], { allowPrimary: true }), /정확히 일치/);
  assert.equal(parcelScopeMessage(primary.address, primary.address), '');
});
