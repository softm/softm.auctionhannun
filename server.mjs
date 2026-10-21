import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));
const port = Number(process.env.PORT || 3000);
const mime = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8"
};

createServer(async (request, response) => {
  try {
    const rawPath = decodeURIComponent(new URL(request.url, `http://${request.headers.host}`).pathname);
    const requested = rawPath === "/" ? "/index.html" : rawPath;
    if (requested.split("/").some(part => part.startsWith(".")) || (/^\/(functions|source-data|android|scripts|tests|node_modules)\//.test(requested) && requested !== "/tests/map-browser.html") || requested === "/data/inbox.json") throw new Error("private file");
    const filePath = normalize(join(root, requested));
    if (relative(root, filePath).startsWith("..") || (await stat(filePath)).isDirectory()) {
      throw new Error("not found");
    }
    response.writeHead(200, {
      "content-type": mime[extname(filePath)] || "application/octet-stream",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff"
    });
    response.end(await readFile(filePath));
  } catch {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("찾을 수 없습니다.");
  }
}).listen(port, "127.0.0.1", () => {
  console.log(`경매한눈 미리보기: http://localhost:${port}`);
});
