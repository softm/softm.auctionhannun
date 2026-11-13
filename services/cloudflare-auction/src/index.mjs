// Dedicated auctionhannun personal workspace Worker.
// Identity only: softm-hannun-account service binding. User data: this Worker's D1.
// All workspace records are encrypted at rest with a Worker secret, not stored in the account DB.
const ORIGINS=new Set(['https://auctionhannun.designboard.net','https://softm.github.io']);
const ACCOUNT_URL='https://softm-hannun-account.softm.workers.dev/api/apps/auctionhannun/session';
const encoder=new TextEncoder(),decoder=new TextDecoder();
const keys=new Set(['cases','favorites','checks','notes','verified','flows']);

function json(data,status=200,origin=''){
  const headers={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',
    'X-Content-Type-Options':'nosniff','Vary':'Origin'};
  if(ORIGINS.has(origin))headers['Access-Control-Allow-Origin']=origin;
  return new Response(JSON.stringify(data),{status,headers});
}
function validWorkspace(value){
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!keys.has(k)))return false;
  if(!Array.isArray(value.cases)||value.cases.length>500||!Array.isArray(value.favorites)||value.favorites.length>5000)return false;
  for(const name of ['checks','notes','verified','flows'])
    if(!value[name]||typeof value[name]!=='object'||Array.isArray(value[name]))return false;
  return true;
}
function b64(bytes){
  // Chunk large workspaces: spreading >100KB of bytes can overflow the JS stack.
  let chars='';for(let i=0;i<bytes.length;i+=8192)chars+=String.fromCharCode(...bytes.subarray(i,i+8192));
  return btoa(chars).replace(/\\+/g,'-').replace(/\\//g,'_').replace(/=+$/,'');
}
function unb64(value){
  if(typeof value!=='string'||!/^[A-Za-z0-9_-]+$/.test(value))throw Error('bad-ciphertext');
  const text=atob(value.replace(/-/g,'+').replace(/_/g,'/')+'='.repeat((4-value.length%4)%4));
  return Uint8Array.from(text,c=>c.charCodeAt(0));
}
async function userKey(env,uid){
  const secret=env.AUCTION_WORKSPACE_KEY_V1;
  if(typeof secret!=='string'||!/^[A-Za-z0-9+/]{43}=$/.test(secret))throw Error('encryption-not-configured');
  const bytes=Uint8Array.from(atob(secret),c=>c.charCodeAt(0));
  if(bytes.length!==32)throw Error('encryption-not-configured');
  const ikm=await crypto.subtle.importKey('raw',bytes,'HKDF',false,['deriveKey']);
  return crypto.subtle.deriveKey({name:'HKDF',hash:'SHA-256',salt:encoder.encode(uid),
    info:encoder.encode('auctionhannun-workspace-v1')},ikm,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);
}
async function encrypt(env,uid,workspace){
  const key=await userKey(env,uid),iv=crypto.getRandomValues(new Uint8Array(12));
  const text=JSON.stringify(workspace);
  const encrypted=await crypto.subtle.encrypt({name:'AES-GCM',iv,
    additionalData:encoder.encode('auctionhannun:'+uid+':v1')},key,encoder.encode(text));
  return {iv:b64(iv),ciphertext:b64(new Uint8Array(encrypted))};
}
async function decrypt(env,uid,row){
  const key=await userKey(env,uid);
  const plain=await crypto.subtle.decrypt({name:'AES-GCM',iv:unb64(row.iv),
    additionalData:encoder.encode('auctionhannun:'+uid+':v1')},key,unb64(row.ciphertext));
  const value=JSON.parse(decoder.decode(plain));
  if(!validWorkspace(value))throw Error('invalid-stored-workspace');
  return value;
}
async function identity(request,env,origin,fetchAccount){
  const bearer=request.headers.get('Authorization')||'';
  if(!/^Bearer [A-Za-z0-9_-]{43}$/.test(bearer))return null;
  const fetcher=fetchAccount||env.ACCOUNT?.fetch?.bind(env.ACCOUNT);
  if(!fetcher)throw Error('account-service-not-bound');
  const response=await fetcher(new Request(ACCOUNT_URL,{headers:{Authorization:bearer,Origin:origin},cache:'no-store'}));
  if(response.status===401||response.status===403)return null;
  if(!response.ok)throw Error('account-service-unavailable');
  const data=await response.json();
  return data.site==='auctionhannun'&&typeof data.uid==='string'&&/^sh_[a-f0-9]{32}$/.test(data.uid)
    ?data.uid:null;
}
export async function handleRequest(request,env,dependencies={}){
  const origin=request.headers.get('Origin')||'';
  const pathname=new URL(request.url).pathname;
  if(pathname==='/health'&&request.method==='GET'){
    try{
      if(!env.WORKSPACE_DB||!env.AUCTION_WORKSPACE_KEY_V1||!env.ACCOUNT)throw Error('not-ready');
      await env.WORKSPACE_DB.prepare('SELECT 1 FROM auction_workspaces LIMIT 1').first();
      return json({ok:true,service:'auctionhannun-personal',database:'separate-d1'},200,origin);
    }catch{return json({ok:false,service:'auctionhannun-personal'},503,origin);}
  }
  if(!origin||!ORIGINS.has(origin))return json({error:'origin_not_allowed'},403,origin);
  if(request.method==='OPTIONS')return new Response(null,{status:204,headers:{
    'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Methods':'GET,PUT,OPTIONS',
    'Access-Control-Allow-Headers':'Authorization,Content-Type','Access-Control-Max-Age':'600','Vary':'Origin'
  }});
  if(pathname!=='/api/workspace')return json({error:'not_found'},404,origin);
  if(!['GET','PUT'].includes(request.method))return json({error:'method_not_allowed'},405,origin);
  if(!env.WORKSPACE_DB)return json({error:'database_unavailable'},503,origin);
  let uid;
  try{uid=await identity(request,env,origin,dependencies.fetchAccount);}
  catch{return json({error:'identity_service_unavailable'},503,origin);}
  if(!uid)return json({error:'unauthorized'},401,origin);
  const db=env.WORKSPACE_DB;
  try{
    if(request.method==='GET'){
      const record=await db.prepare('SELECT revision,iv,ciphertext FROM auction_workspaces WHERE user_id=?').bind(uid).first();
      if(!record)return json({revision:0,workspace:null},200,origin);
      return json({revision:record.revision,workspace:await decrypt(env,uid,record)},200,origin);
    }
    const length=Number(request.headers.get('content-length')||0);
    if(length>210000)return json({error:'payload_too_large'},413,origin);
    const raw=await request.text();
    if(encoder.encode(raw).length>210000)return json({error:'payload_too_large'},413,origin);
    let data;
    try{data=JSON.parse(raw);}catch{return json({error:'invalid_json'},400,origin);}
    if(!Number.isSafeInteger(data?.expectedRevision)||data.expectedRevision<0||!validWorkspace(data.workspace))
      return json({error:'invalid_workspace'},400,origin);
    if(encoder.encode(JSON.stringify(data.workspace)).length>200000)
      return json({error:'payload_too_large'},413,origin);
    const encrypted=await encrypt(env,uid,data.workspace);
    const now=new Date().toISOString();
    let result;
    if(data.expectedRevision===0){
      result=await db.prepare('INSERT INTO auction_workspaces(user_id,revision,iv,ciphertext,created_at,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT DO NOTHING')
        .bind(uid,1,encrypted.iv,encrypted.ciphertext,now,now).run();
    }else{
      result=await db.prepare('UPDATE auction_workspaces SET revision=revision+1,iv=?,ciphertext=?,updated_at=? WHERE user_id=? AND revision=?')
        .bind(encrypted.iv,encrypted.ciphertext,now,uid,data.expectedRevision).run();
    }
    if(result.meta?.changes!==1)return json({error:'revision_conflict'},409,origin);
    return json({revision:data.expectedRevision+1},200,origin);
  }catch{
    // Do not leak workspace plaintext, UID, secret material or D1 details to the client.
    return json({error:'workspace_unavailable'},503,origin);
  }
}
export default {fetch:handleRequest};
