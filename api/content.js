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
    const upstream = await forwardFassRequest({
      endpoint,
      method: req.method,
      body: req.body,
      requestHeaders: req.headers,
    });

    res.status(upstream.status);
    res.setHeader("content-type", upstream.contentType);
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
