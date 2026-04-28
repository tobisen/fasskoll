const FASS_PROXY_BASE = "https://fass.se/api/content?endpoint=";
const FASS_ALLOWED_ORIGIN = "https://cms.fass.se";
const FASS_ALLOWED_PATH_PREFIX = "/api/vard/";
const REQUEST_TIMEOUT_MS = Math.max(
  2_000,
  Math.min(Number(process.env.FASS_REQUEST_TIMEOUT_MS) || 8_000, 20_000),
);
const MAX_TOTAL_REQUEST_TIME_MS = Math.max(
  4_000,
  Math.min(Number(process.env.FASS_MAX_TOTAL_REQUEST_TIME_MS) || 15_000, 60_000),
);
const RETRY_MAX_ATTEMPTS = Math.max(
  1,
  Math.min(Number(process.env.FASS_RETRY_MAX_ATTEMPTS) || 3, 4),
);
const RETRY_BASE_DELAY_MS = Math.max(
  100,
  Math.min(Number(process.env.FASS_RETRY_BASE_DELAY_MS) || 250, 2_000),
);
const RETRY_MAX_DELAY_MS = Math.max(
  RETRY_BASE_DELAY_MS,
  Math.min(Number(process.env.FASS_RETRY_MAX_DELAY_MS) || 2_200, 10_000),
);
const RETRY_JITTER_MS = Math.max(
  0,
  Math.min(Number(process.env.FASS_RETRY_JITTER_MS) || 180, 2_000),
);
const CIRCUIT_BREAKER_THRESHOLD = Math.max(
  1,
  Math.min(Number(process.env.FASS_CIRCUIT_BREAKER_THRESHOLD) || 6, 50),
);
const CIRCUIT_BREAKER_COOLDOWN_MS = Math.max(
  10_000,
  Math.min(Number(process.env.FASS_CIRCUIT_BREAKER_COOLDOWN_MS) || 120_000, 900_000),
);

class FassServiceError extends Error {
  constructor(message, code, status = null) {
    super(message);
    this.name = "FassServiceError";
    this.code = code;
    this.status = status;
  }
}

const breakerState = {
  consecutiveFailures: 0,
  openedUntil: 0,
  openedCount: 0,
  lastOpenedAt: null,
};

function buildFassHeaders(requestHeaders = {}, contentTypeOverride) {
  return {
    accept: requestHeaders.accept || "*/*",
    "accept-language":
      requestHeaders["accept-language"] || "sv-SE,sv;q=0.9,en-US;q=0.8,en;q=0.7",
    "content-type":
      contentTypeOverride ||
      requestHeaders["content-type"] ||
      "text/plain;charset=UTF-8",
    referer: "https://fass.se/health/pharmacy-stock-status",
    origin: "https://fass.se",
    "user-agent": requestHeaders["user-agent"] || "Mozilla/5.0",
  };
}

function isHtmlResponse(text) {
  const trimmed = text.trim().toLowerCase();
  return trimmed.startsWith("<!doctype html") || trimmed.startsWith("<html");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function retryDelayMs(attempt) {
  const expo = Math.min(
    RETRY_BASE_DELAY_MS * 2 ** Math.max(0, attempt - 1),
    RETRY_MAX_DELAY_MS,
  );
  const jitter = Math.floor(Math.random() * RETRY_JITTER_MS);
  return expo + jitter;
}

function remainingBudgetMs(startedAt) {
  return MAX_TOTAL_REQUEST_TIME_MS - (Date.now() - startedAt);
}

function isRetryableStatus(status) {
  return status === 408 || status === 429 || (status >= 500 && status <= 599);
}

function parseRetryAfterMs(headerValue) {
  if (!headerValue || typeof headerValue !== "string") return null;
  const numericSec = Number(headerValue);
  if (Number.isFinite(numericSec) && numericSec >= 0) {
    return Math.min(numericSec * 1000, RETRY_MAX_DELAY_MS);
  }
  const dateMs = Date.parse(headerValue);
  if (Number.isFinite(dateMs)) {
    const delta = Math.max(0, dateMs - Date.now());
    return Math.min(delta, RETRY_MAX_DELAY_MS);
  }
  return null;
}

function isCircuitOpen() {
  return Date.now() < breakerState.openedUntil;
}

function markFailure() {
  breakerState.consecutiveFailures += 1;
  let openedNow = false;
  if (
    breakerState.consecutiveFailures >= CIRCUIT_BREAKER_THRESHOLD &&
    !isCircuitOpen()
  ) {
    breakerState.openedUntil = Date.now() + CIRCUIT_BREAKER_COOLDOWN_MS;
    breakerState.openedCount += 1;
    breakerState.lastOpenedAt = new Date().toISOString();
    openedNow = true;
  }
  return { openedNow };
}

function markSuccess() {
  breakerState.consecutiveFailures = 0;
  breakerState.openedUntil = 0;
}

function isAbortError(error) {
  return (
    error &&
    typeof error === "object" &&
    "name" in error &&
    error.name === "AbortError"
  );
}

function asFriendlyUpstreamError(status, text) {
  const detail = extractUpstreamDetail(text);
  if (status === 429) {
    return `Fass begränsar anrop just nu (429). Försök igen om en stund.${detail ? ` Detalj: ${detail}` : ""}`;
  }
  if (status === 408) {
    return `Fass svarade för långsamt (timeout). Försök igen.${detail ? ` Detalj: ${detail}` : ""}`;
  }
  if (status >= 500) {
    return `Fass är tillfälligt otillgängligt (${status}). Försök igen om en stund.${detail ? ` Detalj: ${detail}` : ""}`;
  }
  if (status >= 400) {
    return `Fass svarade med felkod ${status}.${detail ? ` Detalj: ${detail}` : ""}`;
  }
  if (isHtmlResponse(text)) {
    return "Fass returnerade HTML/felsida istället för JSON.";
  }
  return "Okänt felsvar från Fass.";
}

function extractUpstreamDetail(text) {
  if (typeof text !== "string") return "";
  const trimmed = text.trim();
  if (!trimmed || isHtmlResponse(trimmed)) return "";

  try {
    const parsed = JSON.parse(trimmed);
    if (typeof parsed === "string") {
      return parsed.slice(0, 200);
    }
    if (parsed && typeof parsed === "object") {
      const candidate =
        parsed.message ||
        parsed.error ||
        parsed.detail ||
        parsed.title;
      if (typeof candidate === "string" && candidate.trim()) {
        return candidate.trim().slice(0, 200);
      }
    }
  } catch {
    // not JSON, continue below
  }

  return trimmed.replace(/\s+/g, " ").slice(0, 200);
}

function toNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const n = Number(value.replace(",", "."));
    if (Number.isFinite(n)) return n;
  }
  return null;
}

export function isAllowedFassEndpoint(endpoint) {
  if (typeof endpoint !== "string" || endpoint.trim().length === 0) {
    return false;
  }

  let parsed;
  try {
    parsed = new URL(endpoint.trim());
  } catch {
    return false;
  }

  if (parsed.origin !== FASS_ALLOWED_ORIGIN) return false;
  if (parsed.protocol !== "https:") return false;
  if (parsed.username || parsed.password) return false;
  if (parsed.hash) return false;
  if (!parsed.pathname.startsWith(FASS_ALLOWED_PATH_PREFIX)) return false;
  if (parsed.searchParams.has("endpoint")) return false;

  return true;
}

export function getFassServiceRuntimeState() {
  const now = Date.now();
  const openUntil = breakerState.openedUntil;
  return {
    requestTimeoutMs: REQUEST_TIMEOUT_MS,
    maxTotalRequestTimeMs: MAX_TOTAL_REQUEST_TIME_MS,
    retryMaxAttempts: RETRY_MAX_ATTEMPTS,
    retryBaseDelayMs: RETRY_BASE_DELAY_MS,
    retryMaxDelayMs: RETRY_MAX_DELAY_MS,
    retryJitterMs: RETRY_JITTER_MS,
    circuitBreakerThreshold: CIRCUIT_BREAKER_THRESHOLD,
    circuitBreakerCooldownMs: CIRCUIT_BREAKER_COOLDOWN_MS,
    circuitOpen: openUntil > now,
    circuitOpenUntil: openUntil > now ? new Date(openUntil).toISOString() : null,
    consecutiveFailures: breakerState.consecutiveFailures,
    circuitOpenedCount: breakerState.openedCount,
    lastCircuitOpenedAt: breakerState.lastOpenedAt,
  };
}

export async function forwardFassRequest({
  endpoint,
  method = "GET",
  body,
  requestHeaders = {},
  contentTypeOverride,
}) {
  const startedAt = Date.now();
  if (isCircuitOpen()) {
    throw new FassServiceError(
      "Fass-kopplingen är tillfälligt pausad efter upprepade fel. Försök igen snart.",
      "CIRCUIT_OPEN",
      503,
    );
  }

  const upstreamUrl = `${FASS_PROXY_BASE}${encodeURIComponent(endpoint)}`;
  let lastError = null;

  for (let attempt = 1; attempt <= RETRY_MAX_ATTEMPTS; attempt += 1) {
    const budgetBeforeAttempt = remainingBudgetMs(startedAt);
    if (budgetBeforeAttempt <= 0) {
      throw new FassServiceError(
        `Fass timeout efter total budget ${MAX_TOTAL_REQUEST_TIME_MS} ms`,
        "TOTAL_TIMEOUT",
        504,
      );
    }

    const controller = new AbortController();
    const attemptTimeoutMs = Math.min(REQUEST_TIMEOUT_MS, budgetBeforeAttempt);
    const timeoutId = setTimeout(() => controller.abort(), attemptTimeoutMs);
    try {
      const upstream = await fetch(upstreamUrl, {
        method,
        headers: buildFassHeaders(requestHeaders, contentTypeOverride),
        body: method === "GET" || method === "HEAD" ? undefined : JSON.stringify(body),
        cache: "no-store",
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      const contentType =
        upstream.headers.get("content-type") || "application/json; charset=utf-8";
      const text = await upstream.text();

      if (isRetryableStatus(upstream.status) && attempt < RETRY_MAX_ATTEMPTS) {
        const retryAfter = parseRetryAfterMs(upstream.headers.get("retry-after"));
        const delay = retryAfter ?? retryDelayMs(attempt);
        if (remainingBudgetMs(startedAt) <= delay) {
          throw new FassServiceError(
            `Fass timeout efter total budget ${MAX_TOTAL_REQUEST_TIME_MS} ms`,
            "TOTAL_TIMEOUT",
            504,
          );
        }
        await sleep(delay);
        continue;
      }

      return {
        status: upstream.status,
        contentType,
        text,
      };
    } catch (error) {
      clearTimeout(timeoutId);
      lastError = error;
      if (attempt < RETRY_MAX_ATTEMPTS) {
        const delay = retryDelayMs(attempt);
        if (remainingBudgetMs(startedAt) <= delay) {
          throw new FassServiceError(
            `Fass timeout efter total budget ${MAX_TOTAL_REQUEST_TIME_MS} ms`,
            "TOTAL_TIMEOUT",
            504,
          );
        }
        await sleep(delay);
        continue;
      }
    }
  }

  if (
    isAbortError(lastError) ||
    (lastError instanceof FassServiceError && lastError.code === "TOTAL_TIMEOUT")
  ) {
    throw new FassServiceError(
      `Fass timeout efter total budget ${MAX_TOTAL_REQUEST_TIME_MS} ms`,
      "TIMEOUT",
      504,
    );
  }
  throw lastError instanceof Error
    ? new FassServiceError(`Kunde inte nå Fass: ${lastError.message}`, "NETWORK", 502)
    : new FassServiceError("Kunde inte nå Fass", "NETWORK", 502);
}

export async function fetchFassJson(endpoint, options = {}) {
  const { method = "GET", body, requestHeaders = {} } = options;
  let response;
  try {
    response = await forwardFassRequest({
      endpoint,
      method,
      body,
      requestHeaders,
      contentTypeOverride: "text/plain;charset=UTF-8",
    });
  } catch (error) {
    if (
      isFassServiceError(error) &&
      (error.code === "NETWORK" ||
        error.code === "TIMEOUT" ||
        error.code === "TOTAL_TIMEOUT" ||
        error.code === "CIRCUIT_OPEN")
    ) {
      markFailure();
    }
    throw error;
  }

  if (response.status < 200 || response.status >= 300) {
    if (isRetryableStatus(response.status)) {
      markFailure();
    } else if (response.status < 500) {
      // Client/validation type errors should not open the breaker.
      markSuccess();
    }
    throw new FassServiceError(
      asFriendlyUpstreamError(response.status, response.text),
      "UPSTREAM_STATUS",
      response.status,
    );
  }

  if (isHtmlResponse(response.text)) {
    markFailure();
    throw new FassServiceError(
      asFriendlyUpstreamError(response.status, response.text),
      "UPSTREAM_HTML",
      502,
    );
  }

  try {
    const parsed = JSON.parse(response.text);
    markSuccess();
    return parsed;
  } catch {
    markFailure();
    throw new FassServiceError("Ogiltigt JSON-svar från Fass", "UPSTREAM_JSON", 502);
  }
}

export function isFassServiceError(error) {
  return error instanceof FassServiceError;
}

export function pickCoordinatesFromGeocode(raw) {
  const queue = [raw];
  const visited = new Set();
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || typeof current !== "object") continue;
    if (visited.has(current)) continue;
    visited.add(current);

    if (Array.isArray(current)) {
      for (const item of current) queue.push(item);
      continue;
    }

    const lat = toNumber(current.latitude) ?? toNumber(current.lat);
    const lng = toNumber(current.longitude) ?? toNumber(current.lng) ?? toNumber(current.lon);
    if (lat !== null && lng !== null) {
      return { latitude: lat, longitude: lng };
    }

    if (Array.isArray(current.center) && current.center.length >= 2) {
      const clng = toNumber(current.center[0]);
      const clat = toNumber(current.center[1]);
      if (clat !== null && clng !== null) {
        return { latitude: clat, longitude: clng };
      }
    }

    if (
      current.geometry &&
      Array.isArray(current.geometry.coordinates) &&
      current.geometry.coordinates.length >= 2
    ) {
      const glng = toNumber(current.geometry.coordinates[0]);
      const glat = toNumber(current.geometry.coordinates[1]);
      if (glat !== null && glng !== null) {
        return { latitude: glat, longitude: glng };
      }
    }

    for (const value of Object.values(current)) queue.push(value);
  }

  throw new Error("Kunde inte tolka koordinater.");
}

export function isInStockStatus(code) {
  return code === "IN_STOCK" || code === "FEW_IN_STOCK";
}
