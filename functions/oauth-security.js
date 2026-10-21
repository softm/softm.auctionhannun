import { createHash, createHmac, timingSafeEqual } from "node:crypto";
export const digest = value => createHash("sha256").update(value).digest("hex");
export const validProof = value => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
export function seal(value, secret) {
  const payload = Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${payload}.${createHmac("sha256", secret).update(payload).digest("base64url")}`;
}
export function unseal(value, secret, now = Date.now()) {
  if (typeof value !== "string" || value.length > 4096) throw new Error("invalid state");
  const [payload, signature, extra] = value.split(".");
  const expected = createHmac("sha256", secret).update(payload || "").digest();
  const received = Buffer.from(signature || "", "base64url");
  if (extra || received.length !== expected.length || !timingSafeEqual(received, expected)) throw new Error("invalid signature");
  const result = JSON.parse(Buffer.from(payload, "base64url").toString());
  if (!Number.isFinite(result.expires) || result.expires < now || result.expires > now + 600000) throw new Error("expired state");
  return result;
}
export function allowReturn(url, allowlist) {
  if (typeof url !== "string" || !allowlist.includes(url)) throw new Error("unregistered return URL");
  return new URL(url);
}
export function identity(provider, id) {
  if (!["kakao", "naver"].includes(provider) || !["string", "number"].includes(typeof id) || !String(id)) throw new Error("invalid identity");
  return `${provider}:${digest(String(id))}`; // Never merge identities using unverified emails.
}
export function checkTicket(record, verifier, origin, now = Date.now()) {
  if (!record || !validProof(verifier) || record.expires < now || record.origin !== origin || record.challenge !== digest(verifier)) throw new Error("invalid ticket");
  return record.uid;
}
