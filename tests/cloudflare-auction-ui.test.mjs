import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
test('default auction entry uses Cloudflare, not the Firebase sign-in module',()=>{
  const html=read('index.html'),script=read('cloudflare-auction.js');
  assert.match(html,/id="siteAccountSlot"/);
  assert.match(html,/legacyAccount'\) === '1'/);
  assert.match(html,/import\('\.\/cloudflare-auction\.js'\)/);
  assert.match(html,/if \(legacy\) \{[\s\S]*?import\('\.\/account\.js'\)/);
  assert.match(script,/mountSiteAccount\(/);
  assert.match(script,/legacyVaultUrl/);
  assert.doesNotMatch(script,/firebasejs|FirebaseAuthProvider|Firestore/);
});
test('new account preserves guest and pending copies, never auto-imports Firebase',()=>{
  const src=read('cloudflare-auction.js'),adapter=read('cloudflare-auction-sdk.mjs');
  assert.match(src,/workspace\.switchUser\(nextUid\)/);
  assert.match(src,/workspace\.pending\(activeUid\)/);
  assert.match(src,/workspace\.markSaved/);
  assert.match(src,/mergeGuest\(/);
  assert.match(adapter,/requestAuctionWorkspace/);
});
