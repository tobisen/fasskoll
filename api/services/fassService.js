const FASS_PROXY_BASE = "https://fass.se/api/content?endpoint=";
const FASS_ALLOWED_PREFIX = "https://cms.fass.se/api/vard/";
const REQUEST_TIMEOUT_MS = Math.max(
  2_000,
  Math.min(Number(process.env.FASS_REQUEST_TIMEOUT_MS) || 8_000, 20_000),
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

function isAbortError(error) {
  return (
    error &&
    typeof error === "object" &&
    "name" in error &&
    error.name === "AbortError"
  );
}

function asFriendlyUpstreamError(status, text) {
  if (status === 429) {
    return "Fass begränsar anrop just nu (429). Försök igen om en stund.";
  }
  if (status === 408) {
    return "Fass svarade för långsamt (timeout). Försök igen.";
  }
  if (status >= 500) {
    return `Fass är tillfälligt otillgängligt (${status}). Försök igen om en stund.`;
  }
  if (status >= 400) {
    return `Fass svarade med felkod ${status}.`;
  }
  if (isHtmlResponse(text)) {
    return "Fass returnerade HTML/felsida istället för JSON.";
  }
  return "Okänt felsvar från Fass.";
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
  return typeof endpoint === "string" && endpoint.startsWith(FASS_ALLOWED_PREFIX);
}

export async function forwardFassRequest({
  endpoint,
  method = "GET",
  body,
  requestHeaders = {},
  contentTypeOverride,
}) {
  const upstreamUrl = `${FASS_PROXY_BASE}${encodeURIComponent(endpoint)}`;
  let lastError = null;

  for (let attempt = 1; attempt <= RETRY_MAX_ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
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
        await sleep(retryAfter ?? retryDelayMs(attempt));
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
        await sleep(retryDelayMs(attempt));
        continue;
      }
    }
  }

  if (isAbortError(lastError)) {
    throw new Error(`Fass timeout efter ${REQUEST_TIMEOUT_MS} ms`);
  }
  throw lastError instanceof Error
    ? new Error(`Kunde inte nå Fass: ${lastError.message}`)
    : new Error("Kunde inte nå Fass");
}

export async function fetchFassJson(endpoint, options = {}) {
  const { method = "GET", body, requestHeaders = {} } = options;
  const response = await forwardFassRequest({
    endpoint,
    method,
    body,
    requestHeaders,
    contentTypeOverride: "text/plain;charset=UTF-8",
  });

  if (response.status < 200 || response.status >= 300) {
    throw new Error(asFriendlyUpstreamError(response.status, response.text));
  }

  if (isHtmlResponse(response.text)) {
    throw new Error(asFriendlyUpstreamError(response.status, response.text));
  }

  try {
    return JSON.parse(response.text);
  } catch {
    throw new Error("Ogiltigt JSON-svar från Fass");
  }
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
