import { randomBytes } from "node:crypto";
import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { onRequest } from "firebase-functions/v2/https";
import { defineSecret, defineString } from "firebase-functions/params";
import { digest, seal, unseal, validProof, allowReturn, identity, checkTicket } from "./oauth-security.js";

initializeApp();
const db = getFirestore("auction-workspace");
const signing = defineSecret("SOCIAL_STATE_SECRET");
const kakaoSecret = defineSecret("KAKAO_CLIENT_SECRET"), naverSecret = defineSecret("NAVER_CLIENT_SECRET");
const kakaoId = defineString("KAKAO_CLIENT_ID"), naverId = defineString("NAVER_CLIENT_ID");
const baseUrl = defineString("SOCIAL_BASE_URL");
const returnUrls = defineString("SOCIAL_RETURN_URLS"); // Exact comma-separated URLs, never wildcards.
const config = provider => provider === "kakao" ? {
  id: kakaoId.value(), secret: kakaoSecret.value(), authorize: "https://kauth.kakao.com/oauth/authorize", token: "https://kauth.kakao.com/oauth/token", profile: "https://kapi.kakao.com/v2/user/me"
} : {
  id: naverId.value(), secret: naverSecret.value(), authorize: "https://nid.naver.com/oauth2.0/authorize", token: "https://nid.naver.com/oauth2.0/token", profile: "https://openapi.naver.com/v1/nid/me"
};
const cookieName = "__Secure-auction_oauth";
const cookieOptions = { httpOnly: true, secure: true, sameSite: "lax", path: "/" };
const jsonRequest = async (url, options) => {
  const response = await fetch(url, { ...options, redirect: "error", signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error("provider unavailable");
  return response.json();
};

// Not deployed until billing/server choice and BOTH provider registrations are confirmed.
export const socialAuth = onRequest({ region: "asia-northeast3", secrets: [signing, kakaoSecret, naverSecret], minInstances: 0, maxInstances: 2, timeoutSeconds: 30 }, async (req, res) => {
  res.set("Cache-Control", "no-store"); res.set("Referrer-Policy", "no-referrer");
  const allowlist = returnUrls.value().split(",").map(x => x.trim()).filter(Boolean);
  const origins = new Set(allowlist.map(x => new URL(x).origin));
  const origin = req.get("Origin");
  if (origins.has(origin)) { res.set("Access-Control-Allow-Origin", origin); res.set("Vary", "Origin"); }
  if (req.method === "OPTIONS") {
    if (!origins.has(origin)) return res.sendStatus(403);
    res.set("Access-Control-Allow-Methods", "POST"); res.set("Access-Control-Allow-Headers", "Content-Type"); return res.sendStatus(204);
  }
  try {
    const [action, provider] = req.path.split("/").filter(Boolean);
    if (action === "exchange" && req.method === "POST") {
      if (!origins.has(origin) || !req.is("application/json") || !validProof(req.body?.ticket) || !validProof(req.body?.verifier)) return res.sendStatus(400);
      const ref = db.collection("oauthTickets").doc(digest(req.body.ticket));
      const uid = await db.runTransaction(async tx => {
        const snap = await tx.get(ref);
        const uid = checkTicket(snap.exists ? snap.data() : null, req.body.verifier, origin);
        tx.delete(ref); return uid; // Consume once, before issuing a Firebase credential.
      });
      return res.json({ token: await getAuth().createCustomToken(uid) });
    }
    if (req.method !== "GET" || !["kakao", "naver"].includes(provider)) return res.sendStatus(404);
    const settings = config(provider), redirectUri = `${baseUrl.value()}/callback/${provider}`;
    if (action === "start") {
      const target = allowReturn(req.query.returnTo, allowlist);
      if (!validProof(req.query.challenge)) return res.sendStatus(400);
      const state = randomBytes(32).toString("hex");
      res.cookie(cookieName, seal({ state, provider, returnTo: target.href, challenge: req.query.challenge, expires: Date.now() + 600000 }, signing.value()), { ...cookieOptions, maxAge: 600000 });
      const url = new URL(settings.authorize);
      url.search = new URLSearchParams({ response_type: "code", client_id: settings.id, redirect_uri: redirectUri, state }).toString();
      return res.redirect(302, url.href);
    }
    if (action !== "callback") return res.sendStatus(404);
    const cookie = (req.get("Cookie") || "").split(";").map(x => x.trim()).find(x => x.startsWith(`${cookieName}=`));
    const saved = unseal(decodeURIComponent(cookie?.slice(cookieName.length + 1) || ""), signing.value());
    if (saved.provider !== provider || saved.state !== req.query.state || !validProof(req.query.state)) throw new Error("invalid callback");
    const target = allowReturn(saved.returnTo, allowlist);
    res.clearCookie(cookieName, cookieOptions);
    if (req.query.error || typeof req.query.code !== "string" || req.query.code.length > 4096) throw new Error("authorization cancelled");
    const tokens = await jsonRequest(settings.token, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "authorization_code", client_id: settings.id, client_secret: settings.secret, redirect_uri: redirectUri, code: req.query.code, state: saved.state }) });
    if (typeof tokens.access_token !== "string") throw new Error("invalid provider token");
    const profile = await jsonRequest(settings.profile, { headers: { Authorization: `Bearer ${tokens.access_token}` } });
    if (provider === "naver" && profile.resultcode !== "00") throw new Error("profile unavailable");
    const uid = identity(provider, provider === "kakao" ? profile.id : profile.response?.id);
    const ticket = randomBytes(32).toString("hex"), expires = Date.now() + 120000;
    await db.collection("oauthTickets").doc(digest(ticket)).create({ uid, challenge: saved.challenge, origin: target.origin, expires, expireAt: new Date(expires) });
    target.hash = new URLSearchParams({ ticket }).toString();
    return res.redirect(302, target.href);
  } catch {
    // Never log authorization codes, tokens, provider bodies, or secrets.
    return res.status(400).type("text/plain").send("로그인 연결에 실패했습니다. 경매한눈에서 다시 시작해 주세요.");
  }
});
