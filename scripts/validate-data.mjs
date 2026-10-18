import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { normalizeDataset } from "./collect-auctions.mjs";

const dataset = JSON.parse(await readFile("data/auctions.json", "utf8"));
const normalized = normalizeDataset(dataset, dataset);
const actualHash = createHash("sha256").update(JSON.stringify(normalized.items)).digest("hex");
if (dataset.metadata?.contentHash !== actualHash) throw new Error("data/auctions.json contentHash가 일치하지 않습니다.");
if (dataset.metadata?.itemCount !== normalized.items.length) throw new Error("data/auctions.json itemCount가 일치하지 않습니다.");
console.log(`경매 자료 검증 완료: ${normalized.items.length}건`);
