import { parseSession } from "../auth/_session.js";
import { getMetricsStorageMode, readMetricsState } from "./_store.js";
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

  const state = await readMetricsState();
  const uniqueVisitors = Object.keys(state.visitors || {}).length;
  const traffic = state.traffic || {};
  const byRoute = traffic.byRoute || {};
  const peaks = computePeaks(traffic.minuteBuckets || {});
  const recentErrors = Array.isArray(traffic.recentErrors)
    ? traffic.recentErrors.slice(0, 20)
    : [];

  res.status(200).json({
    uniqueVisitors,
    pageViews: state.pageViews || 0,
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
    },
    peaks,
    fassService: getFassServiceRuntimeState(),
    metricsStorage: getMetricsStorageMode(),
    updatedAt: state.updatedAt || null,
    source: "internal",
  });
}
