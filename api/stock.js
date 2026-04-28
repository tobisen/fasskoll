import {
  fetchFassJson,
  isFassServiceError,
  isInStockStatus,
  pickCoordinatesFromGeocode,
} from "./services/fassService.js";
import { parseSession } from "./auth/_session.js";
import { enforceRateLimit, getClientIp } from "./security/rateLimit.js";
import { getOrSetGuestId } from "./security/guestIdentity.js";
import { enforceKillSwitch } from "./security/killSwitch.js";
import { recordTrafficEvent } from "./metrics/collector.js";

const STOCK_CACHE_TTL_MS =
  Number(process.env.FASS_STOCK_CACHE_TTL_MS) || 90 * 60 * 1000;
const ZIP_CONTEXT_CACHE_TTL_MS =
  Number(process.env.FASS_ZIP_CACHE_TTL_MS) || STOCK_CACHE_TTL_MS;
const MAX_VARIANTS = 25;
const GUEST_STOCK_RATE_LIMIT_PER_MIN = Math.max(
  1,
  Math.min(Number(process.env.FASS_GUEST_STOCK_RATE_LIMIT_PER_MIN) || 8, 30),
);
const GUEST_STOCK_BLOCK_MINUTES = Math.max(
  1,
  Math.min(Number(process.env.FASS_GUEST_STOCK_BLOCK_MINUTES) || 5, 120),
);
const AUTH_STOCK_RATE_LIMIT_PER_MIN = Math.max(
  5,
  Math.min(Number(process.env.FASS_AUTH_STOCK_RATE_LIMIT_PER_MIN) || 40, 240),
);
const AUTH_STOCK_BLOCK_MINUTES = Math.max(
  1,
  Math.min(Number(process.env.FASS_AUTH_STOCK_BLOCK_MINUTES) || 2, 60),
);
const SHARED_CACHE_PREFIX = process.env.FASS_SHARED_CACHE_PREFIX || "fasskoll:stockcache:v1";
const KV_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || "";
const KV_TOKEN =
  process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || "";

const packageZipCache = new Map();
const zipContextCache = new Map();

function hasKvConfig() {
  return typeof KV_URL === "string" && KV_URL.length > 0 && typeof KV_TOKEN === "string" && KV_TOKEN.length > 0;
}

function kvKey(namespace, key) {
  return `${SHARED_CACHE_PREFIX}:${namespace}:${key}`;
}

async function runKvCommand(args) {
  const response = await fetch(KV_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${KV_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(args),
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`KV command failed: ${response.status}`);
  }
  const payload = await response.json();
  return payload?.result;
}

async function readSharedCacheEntry(namespace, key) {
  if (!hasKvConfig()) return null;
  const raw = await runKvCommand(["GET", kvKey(namespace, key)]);
  if (typeof raw !== "string" || raw.length === 0) return null;
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object") return null;
  if (typeof parsed.ts !== "number" || !("data" in parsed)) return null;
  return parsed;
}

async function writeSharedCacheEntry(namespace, key, entry, ttlMs) {
  if (!hasKvConfig()) return;
  const ttlSeconds = Math.max(1, Math.ceil(ttlMs / 1000));
  await runKvCommand(["SETEX", kvKey(namespace, key), ttlSeconds, JSON.stringify(entry)]);
}

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

async function getFreshCacheEntry(cacheMap, namespace, key, ttlMs) {
  const now = Date.now();
  const localEntry = cacheMap.get(key);
  if (localEntry && now - localEntry.ts <= ttlMs) {
    return localEntry;
  }

  try {
    const sharedEntry = await readSharedCacheEntry(namespace, key);
    if (sharedEntry && now - sharedEntry.ts <= ttlMs) {
      cacheMap.set(key, sharedEntry);
      return sharedEntry;
    }
  } catch {
    // ignore shared cache errors and continue without shared cache
  }

  return null;
}

async function setFreshCacheEntry(cacheMap, namespace, key, ttlMs, data) {
  const entry = { ts: Date.now(), data };
  cacheMap.set(key, entry);
  try {
    await writeSharedCacheEntry(namespace, key, entry, ttlMs);
  } catch {
    // ignore shared cache write errors
  }
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

async function buildRowsFromCachedPackages(zipCode, variants) {
  const rows = [];
  const unavailableStrengths = [];
  let usedAnyCache = false;
  let cacheHits = 0;

  for (const variant of variants) {
    const cacheKey = `${zipCode}|${variant.packageId}`;
    const cached = await getFreshCacheEntry(
      packageZipCache,
      "packageZip",
      cacheKey,
      STOCK_CACHE_TTL_MS,
    );
    if (!cached?.data?.baseRows) {
      unavailableStrengths.push(variant.strengthLabel || variant.packageId);
      continue;
    }

    usedAnyCache = true;
    cacheHits += 1;
    for (const baseRow of cached.data.baseRows) {
      rows.push({
        ...baseRow,
        strengthLabel: variant.strengthLabel || variant.packageId,
        packageType: variant.packageType || "-",
      });
    }
  }

  return { rows, unavailableStrengths, usedAnyCache, cacheHits };
}

async function getZipContext(zipCode) {
  const cacheKey = zipCode.trim();
  const cached = await getFreshCacheEntry(
    zipContextCache,
    "zipContext",
    cacheKey,
    ZIP_CONTEXT_CACHE_TTL_MS,
  );
  if (cached) {
    return { ...cached.data, fromCache: true };
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
  await setFreshCacheEntry(
    zipContextCache,
    "zipContext",
    cacheKey,
    ZIP_CONTEXT_CACHE_TTL_MS,
    data,
  );
  return { ...data, fromCache: false };
}

async function getStockRowsForPackageAndZip({ zipCode, packageId, zipContext }) {
  const cacheKey = `${zipCode}|${packageId}`;
  const fresh = await getFreshCacheEntry(
    packageZipCache,
    "packageZip",
    cacheKey,
    STOCK_CACHE_TTL_MS,
  );
  if (fresh) {
    return {
      baseRows: fresh.data.baseRows,
      fromCache: true,
      fromStaleCache: false,
      upstreamCalls: 0,
      cacheHits: 1,
    };
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

    await setFreshCacheEntry(
      packageZipCache,
      "packageZip",
      cacheKey,
      STOCK_CACHE_TTL_MS,
      { baseRows },
    );
    maybeCleanupCaches();
    return {
      baseRows,
      fromCache: false,
      fromStaleCache: false,
      upstreamCalls: 1,
      cacheHits: 0,
    };
  } catch (error) {
    if (previous?.data?.baseRows) {
      return {
        baseRows: previous.data.baseRows,
        fromCache: true,
        fromStaleCache: true,
        upstreamCalls: 1,
        cacheHits: 1,
      };
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
  const ip = getClientIp(req);
  const userAgent =
    typeof req.headers?.["user-agent"] === "string"
      ? req.headers["user-agent"].slice(0, 120)
      : "unknown";
  if (!session) {
    const guestId = getOrSetGuestId(req, res);
    const limited = enforceRateLimit(req, res, {
      scope: "guest-stock",
      key: `${guestId}|${ip}|${userAgent}`,
      maxRequests: GUEST_STOCK_RATE_LIMIT_PER_MIN,
      windowMs: 60_000,
      blockMs: GUEST_STOCK_BLOCK_MINUTES * 60_000,
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
  } else {
    const limited = enforceRateLimit(req, res, {
      scope: "auth-stock",
      key: `${session.username}|${session.sessionNonce}`,
      maxRequests: AUTH_STOCK_RATE_LIMIT_PER_MIN,
      windowMs: 60_000,
      blockMs: AUTH_STOCK_BLOCK_MINUTES * 60_000,
    });
    if (!limited.allowed) {
      res.status(429).json({
        error: "För många lagerförfrågningar för inloggad användare. Försök igen om en stund.",
      });
      await recordTrafficEvent({
        route: "stock",
        status: 429,
        category: "rate_limited",
        message: "Authenticated stock rate limit triggered",
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
    let requestUpstreamCalls = 0;
    let requestCacheHits = 0;
    let zipContext;
    try {
      zipContext = await getZipContext(normalizedZip);
      if (zipContext.fromCache) {
        requestCacheHits += 1;
      } else {
        requestUpstreamCalls += 2; // geocode + pharmacy
      }
    } catch (zipError) {
      const fallback = await buildRowsFromCachedPackages(normalizedZip, variants);
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
          upstreamCalls: requestUpstreamCalls,
          cacheHits: requestCacheHits + fallback.cacheHits,
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
        requestUpstreamCalls += stockRows.upstreamCalls;
        requestCacheHits += stockRows.cacheHits;
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
      upstreamCalls: requestUpstreamCalls,
      cacheHits: requestCacheHits,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Okänt fel";
    const isCircuitOpen =
      isFassServiceError(error) && error.code === "CIRCUIT_OPEN";
    const status =
      isFassServiceError(error) && typeof error.status === "number" && error.status >= 400
        ? error.status
        : 502;
    res.status(status).json({ error: message, degraded: false });
    await recordTrafficEvent({
      route: "stock",
      status,
      category: isCircuitOpen ? "circuit_open" : "upstream_error",
      message,
      success: false,
    });
  }
}
