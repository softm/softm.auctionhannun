import test from "node:test";
import assert from "node:assert/strict";
import { seal, unseal, allowReturn, identity, checkTicket, digest } from "../functions/oauth-security.js";
test("OAuth signed state rejects tampering, expiration and a different signing key", () => {
  const token = seal({ expires: 2000, state: "state" }, "test-secret");
  assert.equal(unseal(token, "test-secret", 1000).state, "state");
  assert.throws(() => unseal(token + "a", "test-secret", 1000));
  assert.throws(() => unseal(token, "other", 1000));
  assert.throws(() => unseal(token, "test-secret", 3000));
});
test("OAuth allows exact return URLs only and separates provider identities", () => {
  const urls = ["https://auctionhannun.designboard.net/auth-callback.html"];
  assert.equal(allowReturn(urls[0], urls).protocol, "https:");
  for (const bad of ["https://attacker.test", urls[0] + "?next=evil", "javascript:alert(1)"]) assert.throws(() => allowReturn(bad, urls));
  assert.notEqual(identity("naver", "123"), identity("kakao", "123"));
  assert.throws(() => identity("naver", undefined));
});
test("one-time ticket must be bound to browser verifier, origin and expiry", () => {
  const verifier = "a".repeat(64), record = { uid: "naver:test", challenge: digest(verifier), origin: "https://app.test", expires: 2000 };
  assert.equal(checkTicket(record, verifier, record.origin, 1000), record.uid);
  assert.throws(() => checkTicket(record, "b".repeat(64), record.origin, 1000));
  assert.throws(() => checkTicket(record, verifier, "https://evil.test", 1000));
  assert.throws(() => checkTicket(record, verifier, record.origin, 3000));
  assert.throws(() => checkTicket(null, verifier, record.origin, 1000));
});
