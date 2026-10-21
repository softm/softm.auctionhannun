import { firebaseConfig } from "./firebase-config.js";
import { socialConfig } from "./social-config.js";
const params = new URLSearchParams(location.hash.slice(1));
history.replaceState(null, "", location.pathname); // Remove one-time ticket before any network request.
try {
  const ticket = params.get("ticket"), pending = JSON.parse(sessionStorage.getItem("auctionhannun:oauth") || "null");
  sessionStorage.removeItem("auctionhannun:oauth");
  if (!socialConfig.baseUrl || !/^[a-f0-9]{64}$/.test(ticket || "") || !pending || pending.expires < Date.now()) throw new Error("expired");
  const response = await fetch(`${socialConfig.baseUrl}/exchange`, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "omit", body: JSON.stringify({ ticket, verifier: pending.verifier }) });
  if (!response.ok) throw new Error("exchange failed");
  const { token } = await response.json();
  const [{ initializeApp }, { getAuth, signInWithCustomToken }] = await Promise.all([import("https://www.gstatic.com/firebasejs/12.4.0/firebase-app.js"), import("https://www.gstatic.com/firebasejs/12.4.0/firebase-auth.js")]);
  await signInWithCustomToken(getAuth(initializeApp(firebaseConfig)), token);
  location.replace("./");
} catch { document.getElementById("status").textContent = "로그인 연결에 실패했거나 유효시간이 지났습니다. 경매한눈으로 돌아가 다시 로그인해 주세요."; }
