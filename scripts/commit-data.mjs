// CI only: generated data is committed by its deepest parent directory.
import { execFileSync } from "node:child_process";
import { stat } from "node:fs/promises";
import { dirname } from "node:path";

const git = args => execFileSync("git", args, { encoding: "utf8" });
if (git(["diff", "--cached", "--name-only"]).trim()) throw new Error("기존 스테이징 변경이 있어 자동 커밋을 중단합니다.");
const files = [...new Set(git(["ls-files", "--modified", "--deleted", "--others", "--exclude-standard", "-z", "--", "data"]).split("\0").filter(Boolean))];
const groups = new Map();
const oversized = [];
for (const file of files) {
  if (!/^data\/(?:onbid(?:-movable)?\/)?(auctions\.json|manifest\.json|collection-status\.json|catalog\/[a-f0-9]{64}\.json\.gz|details\/[a-f0-9]{64}\.json)$/.test(file)) continue;
  try { if ((await stat(file)).size >= 31457280) { oversized.push(file); continue; } } catch (error) { if (error.code !== "ENOENT") throw error; }
  const parent = dirname(file);
  if (!groups.has(parent)) groups.set(parent, []);
  groups.get(parent).push(file);
}
const date = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()).replaceAll("-", "");
for (const [parent, paths] of groups) {
  for (let offset = 0; offset < paths.length; offset += 200) git(["add", "--", ...paths.slice(offset, offset + 200)]);
  if (!git(["diff", "--cached", "--name-only"]).trim()) continue;
  git(["commit", "-m", `${date}_${parent.replaceAll("/", "_")}_경매수집갱신`]);
  const committed = git(["diff-tree", "--no-commit-id", "--name-only", "-r", "HEAD"]).trim().split("\n");
  if (committed.some(path => dirname(path) !== parent || path.endsWith(".DS_Store"))) throw new Error("커밋 디렉토리 검증 실패");
}
if (git(["diff", "--cached", "--name-only"]).trim()) throw new Error("의도하지 않은 스테이징 변경");
if (oversized.length) throw new Error(`대용량 ${oversized.length}개 파일은 스테이징·커밋에서 제외했습니다. 불완전한 자료를 푸시하지 않도록 중단합니다.`);
