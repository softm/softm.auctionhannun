export function minimumAmount(value) {
  const text = String(value || "").replace(/[\s,]/g, "");
  if (!/\d/.test(text)) return Infinity;
  const billions = text.match(/(\d+(?:\.\d+)?)억/);
  const tenThousands = text.match(/(\d+(?:\.\d+)?)만/);
  if (billions || tenThousands) return Number(billions?.[1] || 0) * 100000000 + Number(tenThousands?.[1] || 0) * 10000;
  return /^\d+(?:원)?$/.test(text) ? Number(text.replace(/원$/, "")) : Infinity;
}

export const regionOf = item => String(item.address || "").trim().split(/\s+/)[0];

export function filterAndSortCases(items, { query = "", filter = "all", region = "all", court = "all", kind = "all", sort = "date", favorites = new Set() } = {}) {
  const normalized = query.trim().toLowerCase();
  const matches = items.filter(item => {
    const typeMatch = filter === "all" || (filter === "favorite" ? favorites.has(item.id) : item.type === filter);
    const text = `${item.title} ${item.address} ${item.court} ${item.caseNumber}`.toLowerCase();
    return typeMatch && (kind === "all" || (item.auctionKind || "court") === kind) && (region === "all" || regionOf(item) === region)
      && (court === "all" || item.court === court) && (!normalized || text.includes(normalized));
  });
  if (sort === "recent") return matches;
  return matches.sort((a, b) => {
    if (sort === "minimum") return minimumAmount(a.minimum) - minimumAmount(b.minimum) || 0;
    return (Date.parse(a.saleDate) || Infinity) - (Date.parse(b.saleDate) || Infinity) || 0;
  });
}

export function reviewMetrics(items, favorites, checks) {
  return {
    total: items.length,
    saved: items.filter(item => favorites.has(item.id)).length,
    added: items.filter(item => item.userAdded).length,
    checked: items.reduce((count, item) => count + (item.auctionKind === "onbid" ? ["doc:onbid-notice", "doc:onbid-property", "doc:onbid-appraisal"] : ["doc:sale-spec", "doc:field-report", "doc:appraisal"]).filter(key => checks[item.id]?.[key]).length, 0),
    documents: items.length * 3
  };
}
