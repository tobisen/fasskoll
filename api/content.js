import {
  forwardFassRequest,
  isAllowedFassEndpoint,
  isFassServiceError,
} from "./services/fassService.js";
import { parseSession } from "./auth/_session.js";
import { enforceRateLimit, getClientIp } from "./security/rateLimit.js";
import { enforceKillSwitch } from "./security/killSwitch.js";
import { recordTrafficEvent } from "./metrics/collector.js";

const GUEST_CONTENT_RATE_LIMIT_PER_MIN = Math.max(
  10,
  Math.min(Number(process.env.FASS_GUEST_CONTENT_RATE_LIMIT_PER_MIN) || 24, 120),
);
const GUEST_CONTENT_BLOCK_MINUTES = Math.max(
  1,
  Math.min(Number(process.env.FASS_GUEST_CONTENT_BLOCK_MINUTES) || 3, 60),
);
const CONTENT_CACHE_TTL_MS = Math.max(
  10_000,
  Math.min(Number(process.env.FASS_CONTENT_CACHE_TTL_MS) || 5 * 60_000, 24 * 60 * 60 * 1000),
);
const CONTENT_SHARED_CACHE_PREFIX =
  process.env.FASS_CONTENT_SHARED_CACHE_PREFIX || "fasskoll:contentcache:v1";
const KV_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || "";
const KV_TOKEN =
  process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || "";
const localContentCache = new Map();

function hasKvConfig() {
  return typeof KV_URL === "string" && KV_URL.length > 0 && typeof KV_TOKEN === "string" && KV_TOKEN.length > 0;
}

function sharedCacheKey(endpoint) {
  return `${CONTENT_SHARED_CACHE_PREFIX}:${endpoint}`;
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

async function getCachedContent(endpoint) {
  const now = Date.now();
  const local = localContentCache.get(endpoint);
  if (local && now - local.ts <= CONTENT_CACHE_TTL_MS) {
    return local.data;
  }

  if (!hasKvConfig()) return null;
  try {
    const raw = await runKvCommand(["GET", sharedCacheKey(endpoint)]);
    if (typeof raw !== "string" || raw.length === 0) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || typeof parsed.ts !== "number") return null;
    if (now - parsed.ts > CONTENT_CACHE_TTL_MS) return null;
    if (typeof parsed.data?.text !== "string") return null;
    localContentCache.set(endpoint, parsed);
    return parsed.data;
  } catch {
    return null;
  }
}

async function setCachedContent(endpoint, data) {
  const entry = { ts: Date.now(), data };
  localContentCache.set(endpoint, entry);

  if (!hasKvConfig()) return;
  try {
    const ttlSeconds = Math.max(1, Math.ceil(CONTENT_CACHE_TTL_MS / 1000));
    await runKvCommand([
      "SETEX",
      sharedCacheKey(endpoint),
      ttlSeconds,
      JSON.stringify(entry),
    ]);
  } catch {
    // ignore cache write errors
  }
}

export default async function handler(req, res) {
  if (enforceKillSwitch(res)) {
    await recordTrafficEvent({
      route: "content",
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
      scope: "guest-content",
      key: ip,
      maxRequests: GUEST_CONTENT_RATE_LIMIT_PER_MIN,
      windowMs: 60_000,
      blockMs: GUEST_CONTENT_BLOCK_MINUTES * 60_000,
    });
    if (!limited.allowed) {
      res.status(429).json({
        error: "För många anrop från oinloggad användare. Försök igen om en stund.",
      });
      await recordTrafficEvent({
        route: "content",
        status: 429,
        category: "rate_limited",
        message: "Guest rate limit triggered",
        success: false,
      });
      return;
    }
  }

  const endpoint = req.query?.endpoint;

  if (!endpoint || typeof endpoint !== "string") {
    res.status(400).json({ error: "Missing endpoint query parameter" });
    await recordTrafficEvent({
      route: "content",
      status: 400,
      category: "validation",
      message: "Missing endpoint query parameter",
      success: false,
    });
    return;
  }

  if (!isAllowedFassEndpoint(endpoint)) {
    res.status(400).json({ error: "Endpoint not allowed" });
    await recordTrafficEvent({
      route: "content",
      status: 400,
      category: "validation",
      message: "Endpoint not allowed",
      success: false,
    });
    return;
  }

  try {
    const isGet = req.method === "GET";
    if (isGet) {
      const cached = await getCachedContent(endpoint);
      if (cached) {
        res.status(cached.status);
        res.setHeader("content-type", cached.contentType);
        res.setHeader("X-Fasskoll-Cache", "HIT");
        res.send(cached.text);
        await recordTrafficEvent({
          route: "content",
          status: cached.status,
          category: "request",
          message: "Served from cache",
          success: cached.status < 400,
          upstreamCalls: 0,
          cacheHits: 1,
        });
        return;
      }
    }

    const upstream = await forwardFassRequest({
      endpoint,
      method: req.method,
      body: req.body,
      requestHeaders: req.headers,
    });

    if (req.method === "GET" && upstream.status >= 200 && upstream.status < 300) {
      await setCachedContent(endpoint, {
        status: upstream.status,
        contentType: upstream.contentType,
        text: upstream.text,
      });
    }

    res.status(upstream.status);
    res.setHeader("content-type", upstream.contentType);
    res.setHeader("X-Fasskoll-Cache", "MISS");
    res.send(upstream.text);
    await recordTrafficEvent({
      route: "content",
      status: upstream.status,
      category: upstream.status >= 400 ? "upstream_error" : "request",
      message: upstream.status >= 400 ? "Upstream returned error status" : "OK",
      success: upstream.status < 400,
      upstreamCalls: 1,
      cacheHits: 0,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown proxy error";
    const isCircuitOpen =
      isFassServiceError(error) && error.code === "CIRCUIT_OPEN";
    const status =
      isFassServiceError(error) && typeof error.status === "number" && error.status >= 400
        ? error.status
        : 502;
    res.status(status).json({ error: message });
    await recordTrafficEvent({
      route: "content",
      status,
      category: isCircuitOpen ? "circuit_open" : "proxy_error",
      message,
      success: false,
      upstreamCalls: 1,
      cacheHits: 0,
    });
  }
}
