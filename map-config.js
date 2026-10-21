// Public browser identifiers; keep private REST secrets out of this file.
// Never put a REST secret or DATA_GO_KR_SERVICE_KEY in this file.
export const mapConfig = Object.freeze({
  naverKeyId: "etfcybk8vf",
  // Auctionhannun's own website key, verified in VWorld on 2026-10-19.
  // Development key expires on 2027-04-19; renew or obtain an operation key before then.
  vworldKey: "1EDF9A43-9D01-4787-8DA1-9AE55E98B270",
  vworldServiceOrigin: "https://auctionhannun.designboard.net",
  // Separate public browser key for this exact local development origin.
  // Issued 2026-10-21; expires 2027-04-21. Never use the production key for localhost.
  vworldLocalKey: "46199A78-D0C6-4451-90CF-07A83015C9F4",
  vworldLocalOrigin: "http://localhost:3000",
  geocodeConcurrency: 4,
  geocodeBatchLimit: 40
});
