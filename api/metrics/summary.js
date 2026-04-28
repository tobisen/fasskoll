import { parseSession } from "../auth/_session.js";
import {
  getMetricsStorageMode,
  hasKvMetricsConfig,
  kvGet,
  kvHGetAll,
  kvHSet,
  kvLRange,
  kvSCard,
  kvSet,
  readMetricsState,
} from "./_store.js";
import { getFassServiceRuntimeState } from "../services/fassService.js";

function safeNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function computePeaks(minuteBuckets) {
  const now = Date.now();
  const oneHourAgo = now - 60 * 60 * 1000;
  const oneDayAgo = now - 24 * 60 * 60 * 1000;
  const entries = Object.entries(minuteBuckets || {})
    .map(([minute, count]) => ({
      minute,
      timestamp: Date.parse(`${minute}:00Z`),
      count: safeNumber(count),
    }))
    .filter((entry) => Number.isFinite(entry.timestamp));

  let peakLastHour = 0;
  let peakLast24h = 0;
  let requestsLastHour = 0;
  let requestsLast24h = 0;

  for (const entry of entries) {
    if (entry.timestamp >= oneDayAgo) {
      requestsLast24h += entry.count;
      peakLast24h = Math.max(peakLast24h, entry.count);
    }

    if (entry.timestamp >= oneHourAgo) {
      requestsLastHour += entry.count;
      peakLastHour = Math.max(peakLastHour, entry.count);
    }
  }

  const topPeaks = [...entries]
    .sort((a, b) => b.count - a.count)
    .slice(0, 5)
    .map((entry) => ({ minute: entry.minute, count: entry.count }));

  return {
    peakRequestsPerMinuteLastHour: peakLastHour,
    peakRequestsPerMinuteLast24h: peakLast24h,
    requestsLastHour,
    requestsLast24h,
    topPeaks,
  };
}

function computePeriodStats(
  dayBuckets,
  minuteBuckets,
  pageViewDayBuckets,
  errorDayBuckets,
  visitors,
  visitorDayBuckets = {},
) {
  const now = Date.now();
  const periods = {
    day: 1,
    week: 7,
    month: 30,
    year: 365,
  };

  const dayEntries = Object.entries(dayBuckets || {}).map(([day, count]) => ({
    timestamp: Date.parse(`${day}T00:00:00Z`),
    count: safeNumber(count),
  }));
  const minuteEntries = Object.entries(minuteBuckets || {}).map(([minute, count]) => ({
    timestamp: Date.parse(`${minute}:00Z`),
    count: safeNumber(count),
  }));
  const pageViewEntries = Object.entries(pageViewDayBuckets || {}).map(([day, count]) => ({
    timestamp: Date.parse(`${day}T00:00:00Z`),
    count: safeNumber(count),
  }));
  const errorEntries = Object.entries(errorDayBuckets || {}).map(([day, count]) => ({
    timestamp: Date.parse(`${day}T00:00:00Z`),
    count: safeNumber(count),
  }));

  const result = {};
  for (const [key, days] of Object.entries(periods)) {
    const from = now - days * 24 * 60 * 60 * 1000;
    const requests = dayEntries
      .filter((entry) => Number.isFinite(entry.timestamp) && entry.timestamp >= from)
      .reduce((sum, entry) => sum + entry.count, 0);
    const peakRpm = minuteEntries
      .filter((entry) => Number.isFinite(entry.timestamp) && entry.timestamp >= from)
      .reduce((max, entry) => Math.max(max, entry.count), 0);
    const pageViews = pageViewEntries
      .filter((entry) => Number.isFinite(entry.timestamp) && entry.timestamp >= from)
      .reduce((sum, entry) => sum + entry.count, 0);
    const errors = errorEntries
      .filter((entry) => Number.isFinite(entry.timestamp) && entry.timestamp >= from)
      .reduce((sum, entry) => sum + entry.count, 0);
    const uniqueVisitorsFromState = Object.values(visitors || {}).reduce((sum, value) => {
      const ts =
        value && typeof value === "object" && typeof value.lastSeenAt === "number"
          ? value.lastSeenAt
          : 0;
      return ts >= from ? sum + 1 : sum;
    }, 0);
    const uniqueVisitorsFromDays = Object.entries(visitorDayBuckets || {})
      .map(([day, count]) => ({
        timestamp: Date.parse(`${day}T00:00:00Z`),
        count: safeNumber(count),
      }))
      .filter((entry) => Number.isFinite(entry.timestamp) && entry.timestamp >= from)
      .reduce((sum, entry) => sum + entry.count, 0);
    const uniqueVisitors = uniqueVisitorsFromState > 0 ? uniqueVisitorsFromState : uniqueVisitorsFromDays;
    result[key] = {
      requests,
      pageViews,
      errors,
      uniqueVisitors,
      peakRpm,
      avgPerDay: Math.round(requests / days),
      days,
    };
  }
  return result;
}

function toNumberRecord(input) {
  const out = {};
  if (!input || typeof input !== "object") return out;
  for (const [key, value] of Object.entries(input)) {
    const n = Number(value);
    if (Number.isFinite(n)) out[key] = n;
  }
  return out;
}

function isEmptyRecord(input) {
  return !input || typeof input !== "object" || Object.keys(input).length === 0;
}

async function backfillAtomicFromLegacy(state) {
  const alreadyDone = await kvGet("migration:legacyBackfillDone");
  if (alreadyDone === "1") return;

  const traffic = state?.traffic || {};
  const byRoute = traffic.byRoute || {};
  const routeContent = byRoute.content || {};
  const routeStock = byRoute.stock || {};
  const minuteBuckets = traffic.minuteBuckets || {};
  const dayBuckets = traffic.dayBuckets || {};
  const pageViewDayBuckets = traffic.pageViewDayBuckets || {};
  const visitorHourBuckets = traffic.visitorHourBuckets || {};
  const visitorDayBuckets = traffic.visitorDayBuckets || {};
  const errorMinuteBuckets = traffic.errorMinuteBuckets || {};
  const errorDayBuckets = traffic.errorDayBuckets || {};

  for (const [field, value] of Object.entries(routeContent)) {
    await kvHSet("route:content", field, safeNumber(value));
  }
  for (const [field, value] of Object.entries(routeStock)) {
    await kvHSet("route:stock", field, safeNumber(value));
  }
  for (const [field, value] of Object.entries(minuteBuckets)) {
    await kvHSet("traffic:minute", field, safeNumber(value));
  }
  for (const [field, value] of Object.entries(dayBuckets)) {
    await kvHSet("traffic:day", field, safeNumber(value));
  }
  for (const [field, value] of Object.entries(pageViewDayBuckets)) {
    await kvHSet("pageViews:day", field, safeNumber(value));
  }
  for (const [field, value] of Object.entries(visitorHourBuckets)) {
    await kvHSet("visitors:hour", field, safeNumber(value));
  }
  for (const [field, value] of Object.entries(visitorDayBuckets)) {
    await kvHSet("visitors:day", field, safeNumber(value));
  }
  for (const [field, value] of Object.entries(errorMinuteBuckets)) {
    await kvHSet("errors:minute", field, safeNumber(value));
  }
  for (const [field, value] of Object.entries(errorDayBuckets)) {
    await kvHSet("errors:day", field, safeNumber(value));
  }
  await kvSet("pageViews:total", safeNumber(state?.pageViews || 0));
  if (typeof state?.updatedAt === "string") {
    await kvSet("updatedAt", state.updatedAt);
  }
  await kvSet("migration:legacyBackfillDone", "1");
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const session = parseSession(req);
  if (!session || session.username !== "admin") {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  let uniqueVisitors = 0;
  let pageViews = 0;
  let updatedAt = null;
  let traffic = {};
  let byRoute = {};
  let peaks;
  let periodStats;
  let recentErrors = [];
  let debug = {
    usingKv: false,
    usedLegacyFallback: false,
    minuteKeysCount: 0,
    dayKeysCount: 0,
    pageViewDayKeysCount: 0,
    visitorHourKeysCount: 0,
    visitorDayKeysCount: 0,
    errorMinuteKeysCount: 0,
    errorDayKeysCount: 0,
    recentErrorsCount: 0,
  };

  if (hasKvMetricsConfig()) {
    debug.usingKv = true;
    const [
      routeContentRaw,
      routeStockRaw,
      trafficMinuteRaw,
      trafficDayRaw,
      pageViewsDayRaw,
      visitorsHourRaw,
      visitorsDayRaw,
      errorsMinuteRaw,
      errorsDayRaw,
      recentErrorsRaw,
      pageViewsTotalRaw,
      updatedAtRaw,
      uniqueVisitorsRaw,
    ] = await Promise.all([
      kvHGetAll("route:content"),
      kvHGetAll("route:stock"),
      kvHGetAll("traffic:minute"),
      kvHGetAll("traffic:day"),
      kvHGetAll("pageViews:day"),
      kvHGetAll("visitors:hour"),
      kvHGetAll("visitors:day"),
      kvHGetAll("errors:minute"),
      kvHGetAll("errors:day"),
      kvLRange("errors:recent", 0, 19),
      kvGet("pageViews:total"),
      kvGet("updatedAt"),
      kvSCard("visitors:all"),
    ]);

    uniqueVisitors = safeNumber(uniqueVisitorsRaw);
    pageViews = safeNumber(Number(pageViewsTotalRaw || 0));
    updatedAt = typeof updatedAtRaw === "string" ? updatedAtRaw : null;

    const routeContent = toNumberRecord(routeContentRaw);
    const routeStock = toNumberRecord(routeStockRaw);
    const minuteBuckets = toNumberRecord(trafficMinuteRaw);
    const dayBuckets = toNumberRecord(trafficDayRaw);
    const pageViewDayBuckets = toNumberRecord(pageViewsDayRaw);
    const visitorHourBuckets = toNumberRecord(visitorsHourRaw);
    const visitorDayBuckets = toNumberRecord(visitorsDayRaw);
    const errorMinuteBuckets = toNumberRecord(errorsMinuteRaw);
    const errorDayBuckets = toNumberRecord(errorsDayRaw);
    debug.minuteKeysCount = Object.keys(minuteBuckets).length;
    debug.dayKeysCount = Object.keys(dayBuckets).length;
    debug.pageViewDayKeysCount = Object.keys(pageViewDayBuckets).length;
    debug.visitorHourKeysCount = Object.keys(visitorHourBuckets).length;
    debug.visitorDayKeysCount = Object.keys(visitorDayBuckets).length;
    debug.errorMinuteKeysCount = Object.keys(errorMinuteBuckets).length;
    debug.errorDayKeysCount = Object.keys(errorDayBuckets).length;

    const parseRecentErrors = Array.isArray(recentErrorsRaw)
      ? recentErrorsRaw
          .map((raw) => {
            try {
              return JSON.parse(raw);
            } catch {
              return null;
            }
          })
          .filter((item) => item && typeof item === "object")
      : [];
    recentErrors = parseRecentErrors;
    debug.recentErrorsCount = recentErrors.length;

    traffic = {
      totalRequests:
        safeNumber(routeContent.requests) + safeNumber(routeStock.requests),
      byRoute: {
        content: routeContent,
        stock: routeStock,
      },
      minuteBuckets,
      dayBuckets,
      pageViewDayBuckets,
      visitorHourBuckets,
      visitorDayBuckets,
      errorMinuteBuckets,
      errorDayBuckets,
      recentErrors,
    };
    byRoute = traffic.byRoute;
    peaks = computePeaks(minuteBuckets);
    periodStats = computePeriodStats(
      dayBuckets,
      minuteBuckets,
      pageViewDayBuckets,
      errorDayBuckets,
      {},
      visitorDayBuckets,
    );

    const atomicBucketsEmpty =
      isEmptyRecord(minuteBuckets) &&
      isEmptyRecord(dayBuckets) &&
      isEmptyRecord(pageViewDayBuckets);
    if (atomicBucketsEmpty) {
      debug.usedLegacyFallback = true;
      const legacyState = await readMetricsState();
      const legacyTraffic = legacyState.traffic || {};
      const legacyByRoute = legacyTraffic.byRoute || {};

      uniqueVisitors = Object.keys(legacyState.visitors || {}).length || uniqueVisitors;
      pageViews = safeNumber(legacyState.pageViews) || pageViews;
      updatedAt = legacyState.updatedAt || updatedAt;
      traffic = legacyTraffic;
      byRoute = legacyByRoute;
      recentErrors = Array.isArray(legacyTraffic.recentErrors)
        ? legacyTraffic.recentErrors.slice(0, 20)
        : recentErrors;
      debug.minuteKeysCount = Object.keys(legacyTraffic.minuteBuckets || {}).length;
      debug.dayKeysCount = Object.keys(legacyTraffic.dayBuckets || {}).length;
      debug.pageViewDayKeysCount = Object.keys(legacyTraffic.pageViewDayBuckets || {}).length;
      debug.visitorHourKeysCount = Object.keys(legacyTraffic.visitorHourBuckets || {}).length;
      debug.visitorDayKeysCount = Object.keys(legacyTraffic.visitorDayBuckets || {}).length;
      debug.errorMinuteKeysCount = Object.keys(legacyTraffic.errorMinuteBuckets || {}).length;
      debug.errorDayKeysCount = Object.keys(legacyTraffic.errorDayBuckets || {}).length;
      debug.recentErrorsCount = recentErrors.length;
      peaks = computePeaks(legacyTraffic.minuteBuckets || {});
      periodStats = computePeriodStats(
        legacyTraffic.dayBuckets || {},
        legacyTraffic.minuteBuckets || {},
        legacyTraffic.pageViewDayBuckets || {},
        legacyTraffic.errorDayBuckets || {},
        legacyState.visitors || {},
        legacyTraffic.visitorDayBuckets || {},
      );

      // Fire-and-forget migration attempt.
      backfillAtomicFromLegacy(legacyState).catch(() => {});
    }
  } else {
    const state = await readMetricsState();
    uniqueVisitors = Object.keys(state.visitors || {}).length;
    pageViews = state.pageViews || 0;
    updatedAt = state.updatedAt || null;
    traffic = state.traffic || {};
    byRoute = traffic.byRoute || {};
    peaks = computePeaks(traffic.minuteBuckets || {});
    periodStats = computePeriodStats(
      traffic.dayBuckets || {},
      traffic.minuteBuckets || {},
      traffic.pageViewDayBuckets || {},
      traffic.errorDayBuckets || {},
      state.visitors || {},
      traffic.visitorDayBuckets || {},
    );
    recentErrors = Array.isArray(traffic.recentErrors)
      ? traffic.recentErrors.slice(0, 20)
      : [];
    debug = {
      usingKv: false,
      usedLegacyFallback: false,
      minuteKeysCount: Object.keys(traffic.minuteBuckets || {}).length,
      dayKeysCount: Object.keys(traffic.dayBuckets || {}).length,
      pageViewDayKeysCount: Object.keys(traffic.pageViewDayBuckets || {}).length,
      visitorHourKeysCount: Object.keys(traffic.visitorHourBuckets || {}).length,
      visitorDayKeysCount: Object.keys(traffic.visitorDayBuckets || {}).length,
      errorMinuteKeysCount: Object.keys(traffic.errorMinuteBuckets || {}).length,
      errorDayKeysCount: Object.keys(traffic.errorDayBuckets || {}).length,
      recentErrorsCount: recentErrors.length,
    };
  }

  res.status(200).json({
    uniqueVisitors,
    pageViews,
    traffic: {
      totalRequests: safeNumber(traffic.totalRequests),
      byRoute: {
        content: {
          requests: safeNumber(byRoute.content?.requests),
          success: safeNumber(byRoute.content?.success),
          failed: safeNumber(byRoute.content?.failed),
          rateLimited: safeNumber(byRoute.content?.rateLimited),
          killSwitch: safeNumber(byRoute.content?.killSwitch),
          circuitOpen: safeNumber(byRoute.content?.circuitOpen),
          upstreamCalls: safeNumber(byRoute.content?.upstreamCalls),
          cacheHits: safeNumber(byRoute.content?.cacheHits),
          upstream429: safeNumber(byRoute.content?.upstream429),
          upstream4xx: safeNumber(byRoute.content?.upstream4xx),
          upstream5xx: safeNumber(byRoute.content?.upstream5xx),
        },
        stock: {
          requests: safeNumber(byRoute.stock?.requests),
          success: safeNumber(byRoute.stock?.success),
          failed: safeNumber(byRoute.stock?.failed),
          rateLimited: safeNumber(byRoute.stock?.rateLimited),
          killSwitch: safeNumber(byRoute.stock?.killSwitch),
          circuitOpen: safeNumber(byRoute.stock?.circuitOpen),
          upstreamCalls: safeNumber(byRoute.stock?.upstreamCalls),
          cacheHits: safeNumber(byRoute.stock?.cacheHits),
          upstream429: safeNumber(byRoute.stock?.upstream429),
          upstream4xx: safeNumber(byRoute.stock?.upstream4xx),
          upstream5xx: safeNumber(byRoute.stock?.upstream5xx),
        },
      },
      recentErrors,
      buckets: {
        minute: traffic.minuteBuckets || {},
        day: traffic.dayBuckets || {},
        pageViewsByDay: traffic.pageViewDayBuckets || {},
        visitorHours: traffic.visitorHourBuckets || {},
        visitorDays: traffic.visitorDayBuckets || {},
        errorMinutes: traffic.errorMinuteBuckets || {},
        errorsByDay: traffic.errorDayBuckets || {},
      },
    },
    peaks,
    periodStats,
    fassService: getFassServiceRuntimeState(),
    metricsStorage: getMetricsStorageMode(),
    updatedAt,
    debug,
    source: "internal",
  });
}
