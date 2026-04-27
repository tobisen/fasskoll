import { forwardFassRequest, isAllowedFassEndpoint } from "./services/fassService.js";
import { parseSession } from "./auth/_session.js";
import { enforceRateLimit, getClientIp } from "./security/rateLimit.js";

export default async function handler(req, res) {
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
      return;
    }
  }

  const endpoint = req.query?.endpoint;

  if (!endpoint || typeof endpoint !== "string") {
    res.status(400).json({ error: "Missing endpoint query parameter" });
    return;
  }

  if (!isAllowedFassEndpoint(endpoint)) {
    res.status(400).json({ error: "Endpoint not allowed" });
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
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown proxy error";
    res.status(502).json({ error: message });
  }
}
