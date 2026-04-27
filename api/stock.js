import {
  fetchFassJson,
  isFassServiceError,
  isInStockStatus,
  pickCoordinatesFromGeocode,
} from "./services/fassService.js";
import { parseSession } from "./auth/_session.js";
import { enforceRateLimit, getClientIp } from "./security/rateLimit.js";
import { enforceKillSwitch } from "./security/killSwitch.js";
import { recordTrafficEvent } from "./metrics/collector.js";

const STOCK_CACHE_TTL_MS =
  Number(process.env.FASS_STOCK_CACHE_TTL_MS) || 90 * 60 * 1000;
const ZIP_CONTEXT_CACHE_TTL_MS =
  Number(process.env.FASS_ZIP_CACHE_TTL_MS) || STOCK_CACHE_TTL_MS;
const MAX_VARIANTS = 25;

const packageZipCache = new Map();
const zipContextCache = new Map();

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeZipCode(value) {
  if (typeof value !== "string") return null;
  const cleaned = value.replace(/\s+/g, "");
  if (!/^\d{5}$/.test(cleaned)) return null;
  return cleaned;
}

function normalizePackageId(value) {
  if (typeof value !== "string") return null;
  const cleaned = value.trim();
  if (!/^\d{6,20}$/.test(cleaned)) return null;
  return cleaned;
}

function normalizeVariants(input) {
  if (!Array.isArray(input) || input.length === 0) {
    return { error: "variants krävs" };
  }

  if (input.length > MAX_VARIANTS) {
    return { error: `För många varianter. Max ${MAX_VARIANTS} tillåts.` };
  }

  const normalized = [];
  for (const variant of input) {
    const packageId = normalizePackageId(variant?.packageId);
    if (!packageId) {
      return { error: "Ogiltigt packageId. Endast siffror (6-20 tecken) tillåts." };
    }
    normalized.push({
      packageId,
      strengthLabel: typeof variant?.strengthLabel === "string" ? variant.strengthLabel : "",
      packageType: typeof variant?.packageType === "string" ? variant.packageType : "",
    });
  }

  return { variants: normalized };
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

function buildRowsFromCachedPackages(zipCode, variants) {
  const rows = [];
  const unavailableStrengths = [];
  let usedAnyCache = false;

  for (const variant of variants) {
    const cacheKey = `${zipCode}|${variant.packageId}`;
    const cached = packageZipCache.get(cacheKey);
    if (!cached?.data?.baseRows) {
      unavailableStrengths.push(variant.strengthLabel || variant.packageId);
      continue;
    }

    usedAnyCache = true;
    for (const baseRow of cached.data.baseRows) {
      rows.push({
        ...baseRow,
        strengthLabel: variant.strengthLabel || variant.packageId,
        packageType: variant.packageType || "-",
      });
    }
  }

  return { rows, unavailableStrengths, usedAnyCache };
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
  if (enforceKillSwitch(res)) {
    await recordTrafficEvent({
      route: "stock",
      status: 503,
      category: "kill_switch",
      message: "Kill switch active",
      success: false,
    });
    return;
  }

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
      await recordTrafficEvent({
        route: "stock",
        status: 429,
        category: "rate_limited",
        message: "Guest stock rate limit triggered",
        success: false,
      });
      return;
    }
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    await recordTrafficEvent({
      route: "stock",
      status: 405,
      category: "validation",
      message: "Method not allowed",
      success: false,
    });
    return;
  }

  const normalizedZip = normalizeZipCode(req.body?.zipCode);
  if (!normalizedZip) {
    res.status(400).json({ error: "Ogiltigt postnummer. Ange exakt 5 siffror." });
    await recordTrafficEvent({
      route: "stock",
      status: 400,
      category: "validation",
      message: "Invalid zipCode format",
      success: false,
    });
    return;
  }

  const variantsResult = normalizeVariants(req.body?.variants);
  if ("error" in variantsResult) {
    res.status(400).json({ error: variantsResult.error });
    await recordTrafficEvent({
      route: "stock",
      status: 400,
      category: "validation",
      message: variantsResult.error,
      success: false,
    });
    return;
  }
  const variants = variantsResult.variants;

  try {
    let zipContext;
    try {
      zipContext = await getZipContext(normalizedZip);
    } catch (zipError) {
      const fallback = buildRowsFromCachedPackages(normalizedZip, variants);
      if (fallback.usedAnyCache) {
        res.status(200).json({
          rows: fallback.rows,
          unavailableStrengths: fallback.unavailableStrengths,
          cached: true,
          staleFallback: true,
          degraded: true,
          cacheTtlMs: STOCK_CACHE_TTL_MS,
        });
        await recordTrafficEvent({
          route: "stock",
          status: 200,
          category: "degraded_cache",
          message: "Served stale cache after zip context failure",
          success: true,
        });
        return;
      }

      throw zipError;
    }

    const rows = [];
    const unavailableStrengths = [];
    let usedAnyCache = false;

    for (const variant of variants) {
      const pkgId = variant.packageId;

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
      staleFallback: false,
      degraded: false,
      cacheTtlMs: STOCK_CACHE_TTL_MS,
    });
    await recordTrafficEvent({
      route: "stock",
      status: 200,
      category: unavailableStrengths.length > 0 ? "partial" : "request",
      message:
        unavailableStrengths.length > 0
          ? `Partial response. Failed strengths: ${unavailableStrengths.length}`
          : "OK",
      success: true,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Okänt fel";
    const status =
      isFassServiceError(error) && typeof error.status === "number" && error.status >= 400
        ? error.status
        : 502;
    res.status(status).json({ error: message, degraded: false });
    await recordTrafficEvent({
      route: "stock",
      status,
      category: "upstream_error",
      message,
      success: false,
    });
  }
}
