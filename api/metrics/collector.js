import { readMetricsState, writeMetricsState } from "./_store.js";

const MAX_RECENT_ERRORS = 80;
const MINUTE_BUCKET_RETENTION_MINUTES = 24 * 60;

function minuteKey(date = new Date()) {
  return date.toISOString().slice(0, 16);
}

function trimMinuteBuckets(minuteBuckets) {
  const entries = Object.entries(minuteBuckets);
  if (entries.length <= MINUTE_BUCKET_RETENTION_MINUTES) return;
  entries.sort((a, b) => a[0].localeCompare(b[0]));
  const toRemove = entries.length - MINUTE_BUCKET_RETENTION_MINUTES;
  for (let i = 0; i < toRemove; i += 1) {
    delete minuteBuckets[entries[i][0]];
  }
}

function ensureRoute(state, route) {
  if (!state.traffic.byRoute[route]) {
    state.traffic.byRoute[route] = {
      requests: 0,
      success: 0,
      failed: 0,
      rateLimited: 0,
      killSwitch: 0,
    };
  }
  return state.traffic.byRoute[route];
}

export async function recordTrafficEvent({
  route,
  status = null,
  category = "request",
  message = "",
  success = true,
}) {
  try {
    const state = await readMetricsState();

    state.traffic.totalRequests += 1;
    const routeStats = ensureRoute(state, route);
    routeStats.requests += 1;

    if (category === "rate_limited") {
      routeStats.rateLimited += 1;
    } else if (category === "kill_switch") {
      routeStats.killSwitch += 1;
    }

    if (success) {
      routeStats.success += 1;
    } else {
      routeStats.failed += 1;
      state.traffic.recentErrors.unshift({
        timestamp: new Date().toISOString(),
        route,
        status: typeof status === "number" ? status : null,
        category,
        message: message || "Okänt fel",
      });
      state.traffic.recentErrors = state.traffic.recentErrors.slice(0, MAX_RECENT_ERRORS);
    }

    const key = minuteKey();
    state.traffic.minuteBuckets[key] = (state.traffic.minuteBuckets[key] || 0) + 1;
    trimMinuteBuckets(state.traffic.minuteBuckets);

    state.updatedAt = new Date().toISOString();
    await writeMetricsState(state);
  } catch {
    // Metrics must never break user-facing request flow
  }
}

