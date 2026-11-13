-- Cloudflare D1 database: auctionhannun-personal-db (not the shared account DB).
CREATE TABLE IF NOT EXISTS auction_workspaces (
  user_id TEXT PRIMARY KEY NOT NULL,
  revision INTEGER NOT NULL CHECK (revision > 0),
  iv TEXT NOT NULL,
  ciphertext TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS auction_workspaces_updated ON auction_workspaces(updated_at DESC);
