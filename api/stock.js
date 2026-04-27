import {
  fetchFassJson,
  isInStockStatus,
  pickCoordinatesFromGeocode,
} from "./services/fassService.js";
import { parseSession } from "./auth/_session.js";
import { enforceRateLimit, getClientIp } from "./security/rateLimit.js";

const STOCK_CACHE_TTL_MS =
  Number(process.env.FASS_STOCK_CACHE_TTL_MS) || 90 * 60 * 1000;
const ZIP_CONTEXT_CACHE_TTL_MS =
  Number(process.env.FASS_ZIP_CACHE_TTL_MS) || STOCK_CACHE_TTL_MS;

const packageZipCache = new Map();
const zipContextCache = new Map();

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getFreshCacheEntry(cacheMap, key, ttlMs) {
  const entry = cacheMap.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > ttlMs) return null;
  return entry;
}

function maybeCleanupCaches() {
  if (Math.random() > 0.03) return;
  const now = Date.now();

  for (const [key, value] of packageZipCache.entries()) {
    if (now - value.ts > STOCK_CACHE_TTL_MS * 3) {
      packageZipCache.delete(key);
    }
  }

  for (const [key, value] of zipContextCache.entries()) {
    if (now - value.ts > ZIP_CONTEXT_CACHE_TTL_MS * 3) {
      zipContextCache.delete(key);
    }
  }
}

async function getZipContext(zipCode) {
  const cacheKey = zipCode.trim();
  const cached = getFreshCacheEntry(
    zipContextCache,
    cacheKey,
    ZIP_CONTEXT_CACHE_TTL_MS,
  );
  if (cached) {
    return cached.data;
  }

  const geocode = await fetchFassJson(
    `https://cms.fass.se/api/vard/geocode/reverse?address=${encodeURIComponent(zipCode)}`,
  );
  const { latitude, longitude } = pickCoordinatesFromGeocode(geocode);

  const pharmacies = await fetchFassJson(
    `https://cms.fass.se/api/vard/pharmacy?longitude=${longitude}&latitude=${latitude}&limit=60`,
  );

  const list = Array.isArray(pharmacies) ? pharmacies : [];
  const glnCodes = list
    .map((p) => p?.glnCode)
    .filter((x) => typeof x === "string" && x.length > 0);

  const data = { list, glnCodes };
  zipContextCache.set(cacheKey, { ts: Date.now(), data });
  return data;
}

async function getStockRowsForPackageAndZip({ zipCode, packageId, zipContext }) {
  const cacheKey = `${zipCode}|${packageId}`;
  const fresh = getFreshCacheEntry(packageZipCache, cacheKey, STOCK_CACHE_TTL_MS);
  if (fresh) {
    return { baseRows: fresh.data.baseRows, fromCache: true, fromStaleCache: false };
  }

  const previous = packageZipCache.get(cacheKey);

  try {
    const stockResponse = await fetchFassJson(
      `https://cms.fass.se/api/vard/pharmacy/stock/${encodeURIComponent(packageId)}`,
      { method: "POST", body: zipContext.glnCodes },
    );

    const stockList = Array.isArray(stockResponse) ? stockResponse : [];
    const stockMap = new Map(stockList.map((item) => [item.glnCode, item]));
    const baseRows = zipContext.list.map((pharmacy) => {
      const stock = stockMap.get(pharmacy.glnCode);
      const stockInformation = stock?.stockInformation || "UNKNOWN";
      return {
        key: `${pharmacy.glnCode}-${packageId}`,
        pharmacy,
        stockInformation,
        inStock: isInStockStatus(stockInformation),
      };
    });

    packageZipCache.set(cacheKey, { ts: Date.now(), data: { baseRows } });
    maybeCleanupCaches();
    return { baseRows, fromCache: false, fromStaleCache: false };
  } catch (error) {
    if (previous?.data?.baseRows) {
      return { baseRows: previous.data.baseRows, fromCache: true, fromStaleCache: true };
    }
    throw error;
  }
}

export default async function handler(req, res) {
  const session = parseSession(req);
  if (!session) {
    const ip = getClientIp(req);
    const limited = enforceRateLimit(req, res, {
      scope: "guest-stock",
      key: ip,
      maxRequests: 3,
      windowMs: 60_000,
      blockMs: 20 * 60_000,
    });
    if (!limited.allowed) {
      res.status(429).json({
        error: "För många lagerförfrågningar från oinloggad användare. Försök igen om en stund.",
      });
      return;
    }
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const zipCode = req.body?.zipCode;
  const variants = Array.isArray(req.body?.variants) ? req.body.variants : [];

  if (!zipCode || variants.length === 0) {
    res.status(400).json({ error: 'zipCode och variants krävs' });
    return;
  }

  try {
    const normalizedZip = String(zipCode).trim();
    const zipContext = await getZipContext(normalizedZip);

    const rows = [];
    const unavailableStrengths = [];
    let usedAnyCache = false;

    for (const variant of variants) {
      const pkgId = typeof variant?.packageId === "string" ? variant.packageId.trim() : "";
      if (!pkgId) {
        unavailableStrengths.push(variant?.strengthLabel || "Okänt paket");
        continue;
      }

      try {
        const stockRows = await getStockRowsForPackageAndZip({
          zipCode: normalizedZip,
          packageId: pkgId,
          zipContext,
        });
        usedAnyCache = usedAnyCache || stockRows.fromCache;

        for (const baseRow of stockRows.baseRows) {
          rows.push({
            ...baseRow,
            strengthLabel: variant.strengthLabel || pkgId,
            packageType: variant.packageType || "-",
          });
        }

        if (!stockRows.fromCache) {
          await sleep(220);
        }
      } catch {
        unavailableStrengths.push(variant.strengthLabel || pkgId);
      }      
    }

    res.status(200).json({
      rows,
      unavailableStrengths,
      cached: usedAnyCache,
      cacheTtlMs: STOCK_CACHE_TTL_MS,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Okänt fel';
    res.status(502).json({ error: message });
  }
}
