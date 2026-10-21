// Firebase CLI auth deployment enables providers, but does not apply authorizedDomains.
// Explicit project, narrow update mask, additive change; never print access credentials.
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
const project = "softm-auctionhannun";
const { auth } = JSON.parse(await readFile(new URL("../firebase.json", import.meta.url), "utf8"));
const token = execFileSync("gcloud", ["auth", "print-access-token"], { encoding: "utf8" }).trim();
const headers = { Authorization: `Bearer ${token}`, "x-goog-user-project": project, "Content-Type": "application/json" };
const url = `https://identitytoolkit.googleapis.com/admin/v2/projects/${project}/config`;
const response = await fetch(url, { headers });
if (!response.ok) throw new Error(`Read Auth configuration failed: ${response.status}`);
const current = await response.json();
console.log("Current authorized domains:", current.authorizedDomains);
if (process.argv.includes("--apply")) {
  const authorizedDomains = [...new Set([...(current.authorizedDomains || []), ...auth.authorizedDomains])];
  const changed = await fetch(`${url}?updateMask=authorizedDomains`, { method: "PATCH", headers, body: JSON.stringify({ authorizedDomains }) });
  if (!changed.ok) throw new Error(`Update Auth domains failed: ${changed.status}`);
  const verified = await fetch(url, { headers });
  if (!verified.ok) throw new Error(`Verify Auth domains failed: ${verified.status}`);
  const applied = (await verified.json()).authorizedDomains;
  if (!authorizedDomains.every(domain => applied.includes(domain))) throw new Error("Domain verification failed");
  console.log("Verified authorized domains:", applied);
}
