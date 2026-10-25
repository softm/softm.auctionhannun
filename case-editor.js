import { validateWorkspace } from "./workspace-store.js";

const types = { apartment: "주거", land: "토지·임야", commercial: "상가·업무", movable: "차량·기계·동산", other: "기타" };
export function editRegisteredCase(snapshot, id, values) {
  const data = validateWorkspace(snapshot);
  const item = data.cases.find(row => row.id === id && row.userAdded);
  if (!item) throw new Error("수정할 직접 등록 사건을 찾을 수 없습니다.");
  const fields = {};
  for (const key of ["court", "caseNumber", "address", "type", "saleDate"]) fields[key] = String(values[key] ?? "").trim();
  if (!fields.court || !fields.caseNumber || !fields.address) throw new Error("법원·사건번호·소재지를 입력해 주세요.");
  if (!Object.hasOwn(types, fields.type)) throw new Error("물건 유형을 확인해 주세요.");
  if (fields.saleDate && (!/^\d{4}-\d{2}-\d{2}$/.test(fields.saleDate) || !Number.isFinite(Date.parse(fields.saleDate)) || new Date(fields.saleDate).toISOString().slice(0, 10) !== fields.saleDate)) throw new Error("올바른 매각기일을 입력해 주세요.");
  Object.assign(item, fields, { title: fields.address, category: types[fields.type] });
  return validateWorkspace(data);
}

export function removeRegisteredCase(snapshot, id) {
  const data = validateWorkspace(snapshot);
  if (!data.cases.some(row => row.id === id && row.userAdded)) throw new Error("삭제할 직접 등록 사건을 찾을 수 없습니다.");
  data.cases = data.cases.filter(row => row.id !== id);
  data.favorites = data.favorites.filter(value => value !== id);
  for (const key of ["checks", "notes", "verified"]) delete data[key][id];
  delete data.flows[id];
  return data;
}
