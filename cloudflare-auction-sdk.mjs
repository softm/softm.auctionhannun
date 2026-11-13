// 경매한눈 Cloudflare 공통 신원 인증 → 전용 D1 작업공간 연결.
// 공통 Worker는 SNS 인증만 담당합니다. Firestore는 명시적인 legacy mode에서만 사용합니다.
import {createCloudflareAccountClient} from 'https://softm.github.io/services/cloudflare-account/src/client.mjs?v=20261113-auction-1';

export function createSiteClient({siteId}={}) {
  if(siteId!=='auctionhannun') throw Error('경매한눈 전용 계정 연결입니다.');
  const client=createCloudflareAccountClient({
    baseUrl:'https://softm-hannun-account.softm.workers.dev',siteId
  });
  const listeners=new Set();
  const notify=()=>{for(const fn of listeners)fn(client.currentUser);};
  return Object.freeze({
    siteId,
    get currentUser(){return client.currentUser;},
    onUser(fn){
      if(typeof fn!=='function')throw TypeError('계정 구독 함수를 지정해 주세요.');
      listeners.add(fn);fn(client.currentUser);return ()=>listeners.delete(fn);
    },
    async login({popup,mode='login'}={}){
      const user=await client.login({popup,mode});
      notify();return user;
    },
    async logout(){
      try{await client.logout();}
      finally{notify();}
    },
    readWorkspace:()=>client.requestAuctionWorkspace('GET'),
    saveWorkspace:(workspace,expectedRevision)=>client.requestAuctionWorkspace('PUT',{workspace,expectedRevision})
  });
}
