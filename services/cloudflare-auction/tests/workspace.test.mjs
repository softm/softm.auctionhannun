import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {handleRequest} from '../src/index.mjs';

const ORIGIN='https://auctionhannun.designboard.net';
const TOKEN='A'.repeat(43);
const USER='sh_'+'a'.repeat(32);
const key=randomBytes(32).toString('base64');
const sample=()=>({cases:[],favorites:[],checks:{},notes:{},verified:{},flows:{}});

function fakeDatabase(){
  const rows=new Map();
  return {
    rows,
    prepare(sql){
      return {
        first:async()=>null,
        bind(...args){
          return {
            first:async()=>sql.startsWith('SELECT revision')?(rows.get(args[0])||null):null,
            run:async()=>{
              if(sql.startsWith('INSERT INTO auction_workspaces')){
                if(rows.has(args[0]))return {meta:{changes:0}};
                rows.set(args[0],{revision:args[1],iv:args[2],ciphertext:args[3]});
                return {meta:{changes:1}};
              }
              if(sql.startsWith('UPDATE auction_workspaces')){
                const record=rows.get(args[3]);
                if(!record||record.revision!==args[4])return {meta:{changes:0}};
                rows.set(args[3],{revision:record.revision+1,iv:args[0],ciphertext:args[1]});
                return {meta:{changes:1}};
              }
              return {meta:{changes:0}};
            }
          };
        }
      };
    }
  };
}
function request(method='GET',body,origin=ORIGIN,token=TOKEN){
  return new Request('https://auctionhannun-personal.softm.workers.dev/api/workspace',{
    method,headers:{Origin:origin,Authorization:'Bearer '+token,...(body?{'Content-Type':'application/json'}:{})},
    body:body?JSON.stringify(body):undefined
  });
}
const mockAccount=async()=>new Response(JSON.stringify({uid:USER,site:'auctionhannun'}),{
  headers:{'Content-Type':'application/json'}
});
test('cross-origin and unauthenticated requests cannot reach user workspaces',async()=>{
  const env={WORKSPACE_DB:fakeDatabase(),AUCTION_WORKSPACE_KEY_V1:key};
  assert.equal((await handleRequest(request('GET',null,'https://evil.example'),env)).status,403);
  assert.equal((await handleRequest(request('GET',null,ORIGIN,'bad'),env)).status,401);
  assert.equal((await handleRequest(request('GET'),env)).status,503); // account service binding absent
  const preflight=await handleRequest(new Request('https://example.com/api/workspace',{method:'OPTIONS',headers:{Origin:ORIGIN}}),env);
  assert.equal(preflight.status,204);
  assert.equal(preflight.headers.get('Access-Control-Allow-Origin'),ORIGIN);
});
test('authenticated D1 workspace is encrypted and revision-controlled',async()=>{
  const database=fakeDatabase(),env={WORKSPACE_DB:database,AUCTION_WORKSPACE_KEY_V1:key};
  const deps={fetchAccount:mockAccount};
  const empty=await handleRequest(request(),env,deps);
  assert.deepEqual(await empty.json(),{revision:0,workspace:null});
  const workspace=sample();workspace.notes['court:123']='비공개 권리분석 메모';
  const saved=await handleRequest(request('PUT',{workspace,expectedRevision:0}),env,deps);
  assert.equal(saved.status,200);assert.deepEqual(await saved.json(),{revision:1});
  assert.equal(database.rows.get(USER).ciphertext.includes('비공개'),false);
  const loaded=await handleRequest(request(),env,deps);
  assert.equal(loaded.status,200);
  assert.deepEqual(await loaded.json(),{revision:1,workspace});
  const conflict=await handleRequest(request('PUT',{workspace,expectedRevision:0}),env,deps);
  assert.equal(conflict.status,409);
  const next=await handleRequest(request('PUT',{workspace,expectedRevision:1}),env,deps);
  assert.equal(next.status,200);assert.equal((await next.json()).revision,2);
});
test('server rejects malformed or oversized workspaces without overwriting',async()=>{
  const db=fakeDatabase(),env={WORKSPACE_DB:db,AUCTION_WORKSPACE_KEY_V1:key},deps={fetchAccount:mockAccount};
  assert.equal((await handleRequest(request('PUT',{expectedRevision:0,workspace:{notes:{}}}),env,deps)).status,400);
  const huge=sample();huge.notes.x='x'.repeat(201000);
  assert.equal((await handleRequest(request('PUT',{expectedRevision:0,workspace:huge}),env,deps)).status,413);
  assert.equal(db.rows.size,0);
});
