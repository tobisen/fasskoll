import fs from "node:fs/promises";
import path from "node:path";

const METRICS_FILE = path.join("/tmp", "fasskoll-metrics.json");
const VISITOR_RETENTION_DAYS = Math.max(
  1,
  Math.min(Number(process.env.METRICS_VISITOR_RETENTION_DAYS) || 30, 365),
);
const VISITOR_RETENTION_MS = VISITOR_RETENTION_DAYS * 24 * 60 * 60 * 1000;

function initialState() {
  return {
    pageViews: 0,
    visitors: {},
    updatedAt: null,
    traffic: {
      totalRequests: 0,
      byRoute: {
        content: {
          requests: 0,
          success: 0,
          failed: 0,
          rateLimited: 0,
          killSwitch: 0,
          circuitOpen: 0,
          upstreamCalls: 0,
          cacheHits: 0,
        },
        stock: {
          requests: 0,
          success: 0,
          failed: 0,
          rateLimited: 0,
          killSwitch: 0,
          circuitOpen: 0,
          upstreamCalls: 0,
          cacheHits: 0,
        },
      },
      minuteBuckets: {},
      recentErrors: [],
    },
  };
}

function normalizeVisitors(raw) {
  if (!raw || typeof raw !== "object") return {};

  const now = Date.now();
  const normalized = {};
  for (const [key, value] of Object.entries(raw)) {
    if (typeof key !== "string" || key.length === 0) continue;

    // Backward compatible: old format stored boolean true.
    let lastSeenAt = 0;
    if (value === true) {
      lastSeenAt = now;
    } else if (typeof value === "number" && Number.isFinite(value)) {
      lastSeenAt = value;
    } else if (
      value &&
      typeof value === "object" &&
      typeof value.lastSeenAt === "number" &&
      Number.isFinite(value.lastSeenAt)
    ) {
      lastSeenAt = value.lastSeenAt;
    }

    if (lastSeenAt <= 0) continue;
    if (now - lastSeenAt > VISITOR_RETENTION_MS) continue;
    normalized[key] = { lastSeenAt };
  }

  return normalized;
}

function normalizeRouteStats(raw) {
  if (!raw || typeof raw !== "object") {
    return {
      requests: 0,
      success: 0,
      failed: 0,
      rateLimited: 0,
      killSwitch: 0,
    };
  }

  return {
    requests: typeof raw.requests === "number" ? raw.requests : 0,
    success: typeof raw.success === "number" ? raw.success : 0,
    failed: typeof raw.failed === "number" ? raw.failed : 0,
    rateLimited: typeof raw.rateLimited === "number" ? raw.rateLimited : 0,
    killSwitch: typeof raw.killSwitch === "number" ? raw.killSwitch : 0,
    circuitOpen: typeof raw.circuitOpen === "number" ? raw.circuitOpen : 0,
    upstreamCalls: typeof raw.upstreamCalls === "number" ? raw.upstreamCalls : 0,
    cacheHits: typeof raw.cacheHits === "number" ? raw.cacheHits : 0,
  };
}

function normalizeTraffic(raw) {
  if (!raw || typeof raw !== "object") {
    return initialState().traffic;
  }

  const byRouteRaw = raw.byRoute && typeof raw.byRoute === "object" ? raw.byRoute : {};
  const minuteBucketsRaw =
    raw.minuteBuckets && typeof raw.minuteBuckets === "object" ? raw.minuteBuckets : {};
  const recentErrorsRaw = Array.isArray(raw.recentErrors) ? raw.recentErrors : [];

  const minuteBuckets = {};
  for (const [key, value] of Object.entries(minuteBucketsRaw)) {
    if (typeof key !== "string" || typeof value !== "number" || value < 0) continue;
    minuteBuckets[key] = value;
  }

  const recentErrors = recentErrorsRaw
    .filter((item) => item && typeof item === "object")
    .map((item) => ({
      timestamp:
        typeof item.timestamp === "string" ? item.timestamp : new Date().toISOString(),
      route: typeof item.route === "string" ? item.route : "unknown",
      status: typeof item.status === "number" ? item.status : null,
      category: typeof item.category === "string" ? item.category : "unknown",
      message: typeof item.message === "string" ? item.message : "Okänt fel",
    }))
    .slice(0, 100);

  return {
    totalRequests: typeof raw.totalRequests === "number" ? raw.totalRequests : 0,
    byRoute: {
      content: normalizeRouteStats(byRouteRaw.content),
      stock: normalizeRouteStats(byRouteRaw.stock),
    },
    minuteBuckets,
    recentErrors,
  };
}

function normalizeState(raw) {
  if (!raw || typeof raw !== "object") return initialState();
  const pageViews = typeof raw.pageViews === "number" ? raw.pageViews : 0;
  const visitors = normalizeVisitors(raw.visitors);
  const updatedAt =
    typeof raw.updatedAt === "string" || raw.updatedAt === null ? raw.updatedAt : null;
  const traffic = normalizeTraffic(raw.traffic);
  return { pageViews, visitors, updatedAt, traffic };
}

export async function readMetricsState() {
  try {
    const raw = await fs.readFile(METRICS_FILE, "utf8");
    return normalizeState(JSON.parse(raw));
  } catch {
    return initialState();
  }
}

export async function writeMetricsState(state) {
  const normalized = normalizeState(state);
  const tmpFile = `${METRICS_FILE}.tmp`;
  await fs.writeFile(tmpFile, JSON.stringify(normalized), "utf8");
  await fs.rename(tmpFile, METRICS_FILE);
}
