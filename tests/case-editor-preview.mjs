// Isolated UI fixture: no Firebase account module, real user data or persistent writes.
// Run: node tests/case-editor-preview.mjs, open http://localhost:3011
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
const root = new URL("../", import.meta.url);
const fixture = { id: "user-ui-fixture", userAdded: true, court: "검증용 법원", caseNumber: "UI검증-20261021", address: "수정 기능 검증용 가상 사건", title: "수정 기능 검증용 가상 사건", type: "other", saleDate: "2026-12-01" };
createServer(async (req, res) => {
  try {
    const path = new URL(req.url, "http://localhost:3011").pathname;
    let body, type = "text/javascript";
    if (path === "/") {
      type = "text/html";
      body = (await readFile(new URL("index.html", root), "utf8"))
        .replace('<script type="module" src="./account.js"></script>', '')
        .replace(/<script src="\.\/adfit[^>]+><\/script>/g, '')
        .replace('</head>', '<script type="importmap">{"imports":{"/workspace-store.js":"/fixture-workspace.js","/auction-map.js":"/fixture-map.js"}}</script></head>')
        .replace('경매한눈 |', '격리 UI 검증 |');
    } else if (path === "/fixture-workspace.js") {
      body = `import {createWorkspaceStore, emptyWorkspace} from '/workspace-store.js?fixture'; export * from '/workspace-store.js?fixture'; const values=new Map(); export const workspace=createWorkspaceStore({getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)}); workspace.commit({...emptyWorkspace(),cases:[${JSON.stringify(fixture)}],notes:{'user-ui-fixture':'보존 확인용 메모'},checks:{'user-ui-fixture':{'right:registry':true}},favorites:['user-ui-fixture']});`;
    } else if (path === "/fixture-map.js") {
      body = `export class AuctionMap {constructor(){this.positions=new Map()} async ready(){throw Error('격리된 사건 편집 검증 화면 · 지도 비활성')} render(){} position(){} clearParcel(){} resize(){}}`;
    } else {
      if (!/^\/(?:[a-z-]+\.(?:js|css)|assets\/[a-z-]+\.svg)$/.test(path)) throw Error("not found");
      body = await readFile(new URL(path.slice(1), root));
      type = path.endsWith(".css") ? "text/css" : path.endsWith(".svg") ? "image/svg+xml" : "text/javascript";
    }
    res.writeHead(200, { "content-type": `${type}; charset=utf-8`, "cache-control": "no-store" }); res.end(body);
  } catch { res.writeHead(404); res.end("not found"); }
}).listen(3011, "127.0.0.1", () => console.log("격리 UI 검증: http://localhost:3011 (Firebase 및 실제 계정 정보 사용 안 함)"));
