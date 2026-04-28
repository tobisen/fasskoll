import crypto from "node:crypto";

const GUEST_COOKIE_NAME = "fasskoll_guest_id";
const MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

function parseCookies(req) {
  const raw = req.headers?.cookie;
  const out = {};
  if (!raw) return out;
  for (const part of raw.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (!k) continue;
    out[k] = decodeURIComponent(rest.join("="));
  }
  return out;
}

function shouldUseSecureCookie(req) {
  if (process.env.NODE_ENV === "production") return true;
  const proto = req.headers?.["x-forwarded-proto"];
  return proto === "https";
}

function isValidGuestId(value) {
  return typeof value === "string" && /^[a-f0-9]{24,64}$/i.test(value);
}

function appendSetCookie(res, cookieValue) {
  const current = res.getHeader("Set-Cookie");
  if (!current) {
    res.setHeader("Set-Cookie", cookieValue);
    return;
  }
  if (Array.isArray(current)) {
    res.setHeader("Set-Cookie", [...current, cookieValue]);
    return;
  }
  res.setHeader("Set-Cookie", [current, cookieValue]);
}

export function getOrSetGuestId(req, res) {
  const cookies = parseCookies(req);
  const existing = cookies[GUEST_COOKIE_NAME];
  if (isValidGuestId(existing)) {
    return existing;
  }

  const guestId = crypto.randomBytes(16).toString("hex");
  const parts = [
    `${GUEST_COOKIE_NAME}=${encodeURIComponent(guestId)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${MAX_AGE_SECONDS}`,
  ];
  if (shouldUseSecureCookie(req)) {
    parts.push("Secure");
  }
  appendSetCookie(res, parts.join("; "));
  return guestId;
}

