import {workspace,emptyWorkspace,mergeGuest} from './workspace-store.js';
import {createAccountContext} from 'https://softm.github.io/shared/platform/v1/site-account.mjs?v=20261113-auction-1';
import {mountSiteAccount} from 'https://softm.github.io/shared/platform/v1/account-menu.mjs?v=20261113-auction-1';

const $=id=>document.getElementById(id);
const siteId='auctionhannun';
const account=createAccountContext({
  siteId,
  sdkLoader:()=>import('./cloudflare-auction-sdk.mjs'),
  accountPageUrl:'https://softm-hannun-account.softm.workers.dev/account',
  legacyVaultUrl:new URL('./?legacyAccount=1',location.href).href
});
const dialog=$('accountDialog'),statusBar=$('accountStatus');
$('accountProviders').hidden=true;
$('logoutAccount').hidden=true; // 로그아웃은 공통 프로필 메뉴가 담당합니다.
$('accountIdentity').textContent='내 경매 작업공간';
$('accountButton').hidden=true;
const accountMenu=mountSiteAccount({siteId,name:'경매한눈',accountTarget:'#siteAccountSlot',account,
  vault:{open:()=>dialog.showModal()}});
let activeUid=null,client=null,epoch=0,revision=0,dirty=false,saving=false,blocked=false;
let remoteLoaded=false,loading=false,timer=null,remoteSnapshot=emptyWorkspace();

function message(value,show=true){
  $('accountDialogStatus').textContent=value;
  statusBar.textContent=value;
  statusBar.hidden=!show;
}
function pending(){return activeUid&&workspace.pending(activeUid);}
function showPending(){
  const exists=!!pending();
  $('restorePending').hidden=!exists||!remoteLoaded;
  $('keepServer').hidden=!exists||!remoteLoaded;
  if(exists&&remoteLoaded)workspace.lock();
  return exists;
}
function download(data){
  const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));
  const a=document.createElement('a');
  a.href=url;a.download='auctionhannun-backup-'+Date.now()+'.json';a.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function setBusy(locked){
  for(const id of ['importGuest','retrySave','reloadCloud','restorePending','keepServer','clearCloud'])
    $(id).disabled=locked;
}
function serverError(error){
  if(error?.status===401)return '계정 인증이 만료되었습니다. 계정 메뉴에서 다시 로그인해 주세요. 로컬 사본은 유지합니다.';
  if(error?.status===409)return '다른 기기의 변경 내용과 충돌했습니다. 내 사본을 백업하고 서버 자료를 다시 확인해 주세요.';
  return '전용 Cloudflare 작업공간 서버에 연결되지 않았습니다. 변경 내용은 이 기기에 보관됩니다.';
}
async function startAccount(user){
  const nextUid=user?.uid||null;
  if(nextUid===activeUid)return;
  ++epoch;clearTimeout(timer);
  dirty=false;saving=false;blocked=false;remoteLoaded=false;loading=false;revision=0;client=null;
  activeUid=nextUid;
  $('accountSignedIn').hidden=!nextUid;
  $('restorePending').hidden=true;$('keepServer').hidden=true;
  if(!nextUid){
    workspace.switchUser(null);
    message('비로그인 · 변경 내용은 현재 기기에 저장됩니다.',false);
    return;
  }
  workspace.switchUser(nextUid);
  const generation=epoch;
  loading=true;setBusy(true);
  message('Cloudflare 계정 작업공간을 확인하는 중…');
  try{
    client=await account.ready();
    const remote=await client.readWorkspace();
    if(generation!==epoch)return;
    revision=remote.revision;
    remoteSnapshot=remote.workspace||emptyWorkspace();
    remoteLoaded=true;blocked=false;
    workspace.load(remoteSnapshot);
    if(showPending())message('이전에 전송하지 못한 로컬 기록이 있습니다. 내 작업공간에서 복구 또는 서버 자료 사용을 선택해 주세요.');
    else message('Cloudflare 계정 작업공간에 연결되었습니다.',false);
  }catch(error){
    if(generation!==epoch)return;
    blocked=true;remoteLoaded=false;
    // The pending copy belongs to the authenticated Cloudflare UID, not a Firebase UID.
    const local=pending();
    workspace.load(local||emptyWorkspace());
    message(serverError(error));
  }finally{
    if(generation===epoch){loading=false;setBusy(false);}
  }
}
async function flush(){
  if(!activeUid||!client||!remoteLoaded||blocked||!dirty||saving||loading)return;
  const generation=epoch,uid=activeUid,writer=client;
  const snapshot=workspace.snapshot(),expected=revision;
  dirty=false;saving=true;
  message('내 경매 작업을 저장하는 중…');
  try{
    const result=await writer.saveWorkspace(snapshot,expected);
    if(generation!==epoch)return;
    revision=result.revision;remoteSnapshot=snapshot;
    workspace.markSaved(uid,snapshot);
    message('계정 저장 완료 · '+new Date().toLocaleTimeString('ko-KR'),false);
  }catch(error){
    if(generation!==epoch)return;
    dirty=true;blocked=true;
    message(serverError(error));
  }finally{
    if(generation===epoch){saving=false;if(dirty&&!blocked)void flush();}
  }
}
workspace.subscribe(({change})=>{
  if(!change||!activeUid)return;
  dirty=true;clearTimeout(timer);
  if(blocked){message('로컬 사본에 보관됨 · 서버 동기화가 필요합니다.');return;}
  message('변경 내용 저장 대기 중…');
  timer=setTimeout(()=>void flush(),800);
});
window.addEventListener('beforeunload',event=>{
  if(saving||(dirty&&!blocked)){event.preventDefault();event.returnValue='';}
});
account.subscribe(user=>{void startAccount(user);});
$('closeAccount').addEventListener('click',()=>dialog.close());
$('retrySave').addEventListener('click',async()=>{
  if(!activeUid||saving||loading)return;
  if(!remoteLoaded){await reloadRemote();return;}
  blocked=false;dirty=!!pending()||dirty;
  void flush();
});
async function reloadRemote(){
  if(!activeUid||saving||loading)return;
  if(dirty&&!confirm('로컬 작업을 백업한 뒤 서버 자료를 다시 확인하시겠습니까?'))return;
  if(dirty)download(workspace.snapshot());
  const generation=++epoch;
  clearTimeout(timer);loading=true;setBusy(true);workspace.lock();
  try{
    client=await account.ready();
    const remote=await client.readWorkspace();
    if(generation!==epoch)return;
    revision=remote.revision;remoteSnapshot=remote.workspace||emptyWorkspace();
    remoteLoaded=true;blocked=false;dirty=false;
    workspace.load(remoteSnapshot);
    if(showPending())message('서버 자료를 불러왔습니다. 미전송 로컬 사본을 복구하거나 서버 자료를 선택해 주세요.');
    else message('서버 자료를 다시 불러왔습니다.',false);
  }catch(error){
    if(generation!==epoch)return;
    blocked=true;remoteLoaded=false;
    workspace.load(pending()||emptyWorkspace());
    message(serverError(error));
  }finally{if(generation===epoch){loading=false;setBusy(false);}}
}
$('reloadCloud').addEventListener('click',()=>void reloadRemote());
$('importGuest').addEventListener('click',()=>{
  if(!activeUid||saving||loading||blocked||!remoteLoaded||
    !confirm('비로그인 작업을 현재 계정에 가져올까요? 중복 자료는 계정 자료를 우선하며 원본은 보존합니다.'))return;
  try{workspace.replace(mergeGuest(workspace.snapshot(),workspace.guest()));}
  catch(error){message(error.message);}
});
$('restorePending').addEventListener('click',()=>{
  if(!activeUid||saving||!remoteLoaded)return;
  const local=pending();
  if(!local||!confirm('미전송 로컬 사본으로 현재 계정 작업을 교체할까요? 서버 기록은 먼저 JSON으로 다운로드합니다.'))return;
  try{
    download(remoteSnapshot);
    workspace.load(remoteSnapshot);
    $('restorePending').hidden=true;$('keepServer').hidden=true;
    workspace.replace(local);
  }catch(error){workspace.lock();message(error.message);}
});
$('keepServer').addEventListener('click',()=>{
  if(!activeUid||saving||!remoteLoaded)return;
  const local=pending();
  if(!local||!confirm('미전송 로컬 사본을 내려받고 서버 자료로 계속하시겠습니까?'))return;
  download(local);
  workspace.markSaved(activeUid,local);
  workspace.load(remoteSnapshot);
  $('restorePending').hidden=true;$('keepServer').hidden=true;
  dirty=false;blocked=false;
  message('서버 자료를 유지합니다.',false);
});
$('exportWorkspace').addEventListener('click',()=>download(pending()||workspace.snapshot()));
$('clearCloud').addEventListener('click',()=>{
  if(!activeUid||saving||blocked||!remoteLoaded||
    !confirm('계정 작업을 비우시겠습니까? 변경 전 기록을 JSON으로 백업합니다.'))return;
  download(workspace.snapshot());
  workspace.replace(emptyWorkspace());
});
window.SoftmAccounts ||= new Map();
window.SoftmAccounts.set(siteId,account);
window.dispatchEvent(new CustomEvent('softm:account-ready',{detail:{siteId,account,backend:'cloudflare'}}));
window.addEventListener('pagehide',()=>{accountMenu.destroy();account.destroy();},{once:true});
