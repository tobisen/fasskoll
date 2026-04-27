const buckets = new Map();

function maybeCleanup(now) {
  if (Math.random() > 0.02) return;
  for (const [key, entry] of buckets.entries()) {
    const expired =
      now - entry.windowStart > entry.windowMs * 4 && now > entry.blockedUntil;
    if (expired) buckets.delete(key);
  }
}

export function getClientIp(req) {
  const forwarded = req.headers?.["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim().length > 0) {
    return forwarded.split(",")[0].trim();
  }

  const realIp = req.headers?.["x-real-ip"];
  if (typeof realIp === "string" && realIp.trim().length > 0) {
    return realIp.trim();
  }

  return req.socket?.remoteAddress || "unknown";
}

export function enforceRateLimit(req, res, options) {
  const {
    scope,
    key,
    maxRequests,
    windowMs,
    blockMs,
  } = options;

  const now = Date.now();
  const bucketKey = `${scope}:${key}`;
  const current = buckets.get(bucketKey) ?? {
    count: 0,
    windowStart: now,
    blockedUntil: 0,
    windowMs,
  };

  if (current.blockedUntil > now) {
    const retryAfterSec = Math.ceil((current.blockedUntil - now) / 1000);
    res.setHeader("Retry-After", String(retryAfterSec));
    res.setHeader("X-RateLimit-Limit", String(maxRequests));
    res.setHeader("X-RateLimit-Remaining", "0");
    res.setHeader("X-RateLimit-Reset", String(retryAfterSec));
    buckets.set(bucketKey, current);
    return { allowed: false, retryAfterSec };
  }

  if (now - current.windowStart >= windowMs) {
    current.windowStart = now;
    current.count = 0;
  }

  current.count += 1;
  current.windowMs = windowMs;

  const remaining = Math.max(0, maxRequests - current.count);
  const resetSec = Math.max(
    1,
    Math.ceil((current.windowStart + windowMs - now) / 1000),
  );

  res.setHeader("X-RateLimit-Limit", String(maxRequests));
  res.setHeader("X-RateLimit-Remaining", String(remaining));
  res.setHeader("X-RateLimit-Reset", String(resetSec));

  if (current.count > maxRequests) {
    current.blockedUntil = now + blockMs;
    const retryAfterSec = Math.ceil(blockMs / 1000);
    res.setHeader("Retry-After", String(retryAfterSec));
    buckets.set(bucketKey, current);
    maybeCleanup(now);
    return { allowed: false, retryAfterSec };
  }

  buckets.set(bucketKey, current);
  maybeCleanup(now);
  return { allowed: true, retryAfterSec: 0 };
}

