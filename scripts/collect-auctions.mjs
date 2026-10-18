import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const allowedTypes = new Set(["apartment", "land", "commercial", "other"]);
const forbiddenKeys = /^(ownerName|tenantName|residentRegistrationNumber|phone|email)$/i;
const residentNumberPattern = /\b\d{6}\s*[- ]?\s*[1-4]\d{6}\b/;

function clean(value, max = 180) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

function requireText(item, key) {
  const value = clean(item[key]);
  if (!value) throw new Error(`필수값 누락: ${key}`);
  return value;
}

function validateSourceUrl(value) {
  const url = new URL(requireText({ value }, "value"));
  if (url.protocol !== "https:") throw new Error(`HTTPS 출처만 허용합니다: ${url.href}`);
  return url.href;
}

export function containsSensitiveData(value) {
  if (typeof value === "string") return residentNumberPattern.test(value);
  if (Array.isArray(value)) return value.some(containsSensitiveData);
  if (value && typeof value === "object") {
    return Object.entries(value).some(([key, entry]) => forbiddenKeys.test(key) || containsSensitiveData(entry));
  }
  return false;
}

export function normalizeItem(item, index) {
  if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error(`물건 ${index + 1}: 객체가 아닙니다.`);
  if (containsSensitiveData(item)) throw new Error(`물건 ${index + 1}: 개인정보로 의심되는 필드 또는 값이 있습니다.`);
  const type = allowedTypes.has(item.type) ? item.type : "other";
  const saleDate = clean(item.saleDate, 10);
  if (saleDate && !/^\d{4}-\d{2}-\d{2}$/.test(saleDate)) throw new Error(`물건 ${index + 1}: 매각기일 형식은 YYYY-MM-DD입니다.`);
  const pos = Array.isArray(item.pos) && item.pos.length === 2
    ? item.pos.map(value => Math.max(5, Math.min(95, Number(value) || 50)))
    : [35 + (index * 13) % 48, 33 + (index * 17) % 45];

  return {
    id: requireText(item, "id"),
    demo: Boolean(item.demo),
    type,
    title: clean(item.title) || requireText(item, "address"),
    address: requireText(item, "address"),
    court: requireText(item, "court"),
    caseNumber: requireText(item, "caseNumber"),
    itemNumber: clean(item.itemNumber, 40),
    saleDate,
    appraisal: clean(item.appraisal) || "공식 확인",
    minimum: clean(item.minimum) || "공식 확인",
    ratio: clean(item.ratio, 30) || "-",
    rounds: clean(item.rounds, 80) || "공식 확인",
    area: clean(item.area, 80) || "원문 확인",
    occupancy: clean(item.occupancy) || "현황조사서 확인",
    category: clean(item.category, 80) || "기타",
    pos,
    sourceUrl: validateSourceUrl(item.sourceUrl)
  };
}

export function normalizeDataset(input, previous = null, now = new Date()) {
  if (!input || !Array.isArray(input.items)) throw new Error("items 배열이 필요합니다.");
  const items = input.items.map(normalizeItem);
  const ids = new Set();
  for (const item of items) {
    if (ids.has(item.id)) throw new Error(`중복 id: ${item.id}`);
    ids.add(item.id);
  }
  items.sort((a, b) => (a.saleDate || "9999").localeCompare(b.saleDate || "9999") || a.id.localeCompare(b.id));
  const contentHash = createHash("sha256").update(JSON.stringify(items)).digest("hex");
  const unchanged = previous?.metadata?.contentHash === contentHash;
  const metadata = {
    schemaVersion: 1,
    demo: input.metadata?.demo !== false,
    sourceType: clean(input.metadata?.sourceType, 60) || "reviewed-json",
    sourceUrl: validateSourceUrl(input.metadata?.sourceUrl || items[0]?.sourceUrl),
    collectedAt: unchanged && previous.metadata.collectedAt ? previous.metadata.collectedAt : now.toISOString(),
    itemCount: items.length,
    contentHash
  };
  return { metadata, items };
}

function option(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

async function readInput() {
  const feedUrl = clean(process.env.AUCTION_FEED_URL, 500);
  if (!feedUrl) return JSON.parse(await readFile(option("--input", "data/inbox.json"), "utf8"));
  const url = new URL(feedUrl);
  if (url.protocol !== "https:") throw new Error("AUCTION_FEED_URL은 HTTPS만 허용합니다.");
  const response = await fetch(url, {
    headers: { accept: "application/json", "user-agent": "softm.auctionhannun-data-collector/1.0" },
    signal: AbortSignal.timeout(20000)
  });
  if (!response.ok) throw new Error(`피드 응답 오류: HTTP ${response.status}`);
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("json")) throw new Error("HTML 크롤링은 허용하지 않습니다. JSON 피드가 필요합니다.");
  return response.json();
}

async function main() {
  const outputPath = option("--output", "data/auctions.json");
  const input = await readInput();
  let previous = null;
  try { previous = JSON.parse(await readFile(outputPath, "utf8")); } catch {}
  const result = normalizeDataset(input, previous);
  await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  console.log(`경매 자료 ${result.items.length}건 정규화 완료 (${result.metadata.contentHash.slice(0, 12)})`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
