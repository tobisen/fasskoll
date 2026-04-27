import {
  forwardFassRequest,
  isAllowedFassEndpoint,
  isFassServiceError,
} from "./services/fassService.js";
import { parseSession } from "./auth/_session.js";
import { enforceRateLimit, getClientIp } from "./security/rateLimit.js";
import { enforceKillSwitch } from "./security/killSwitch.js";
import { recordTrafficEvent } from "./metrics/collector.js";

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
      maxRequests: 8,
      windowMs: 60_000,
      blockMs: 10 * 60_000,
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
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown proxy error";
    const status =
      isFassServiceError(error) && typeof error.status === "number" && error.status >= 400
        ? error.status
        : 502;
    res.status(status).json({ error: message });
    await recordTrafficEvent({
      route: "content",
      status,
      category: "proxy_error",
      message,
      success: false,
    });
  }
}
