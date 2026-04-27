import crypto from "node:crypto";

const SESSION_COOKIE_NAME = "fasskoll_session";
const DEFAULT_USERS = {
  "Jenny&Tobbe":
    "220f24a42a45b1490ee59ada37b9f6232dccc3cd28b1d6ba43e16c6a561935f2",
  admin:
    "cf44996d6a28ef5dfec3b4a3a9076a4e385400ce8688ff93f3b887f9c4ea26b0",
};
const PASSWORD_SALT = process.env.AUTH_PASSWORD_SALT || "fasskoll-v1-salt";
const SESSION_SECRET =
  process.env.AUTH_SESSION_SECRET || "change-me-in-vercel-env";

const MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

function base64url(input) {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function fromBase64url(input) {
  const b64 = input.replace(/-/g, "+").replace(/_/g, "/");
  const pad = b64.length % 4;
  const normalized = pad ? b64 + "=".repeat(4 - pad) : b64;
  return Buffer.from(normalized, "base64");
}

function sign(value) {
  return base64url(
    crypto.createHmac("sha256", SESSION_SECRET).update(value).digest(),
  );
}

function timingSafeEqualString(a, b) {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
}

function parseCookies(req) {
  const raw = req.headers?.cookie;
  const result = {};
  if (!raw) return result;
  for (const part of raw.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (!key) continue;
    result[key] = decodeURIComponent(rest.join("="));
  }
  return result;
}

function getConfiguredUsers() {
  if (process.env.AUTH_USERS_JSON) {
    try {
      const parsed = JSON.parse(process.env.AUTH_USERS_JSON);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed;
      }
    } catch {
      // fall back to single user/default users
    }
  }

  if (process.env.AUTH_USERNAME && process.env.AUTH_PASSWORD_HASH) {
    return {
      [process.env.AUTH_USERNAME]: process.env.AUTH_PASSWORD_HASH,
    };
  }

  return DEFAULT_USERS;
}

function hashPassword(password) {
  return crypto
    .pbkdf2Sync(password, PASSWORD_SALT, 210000, 32, "sha256")
    .toString("hex");
}

export function verifyCredentials(username, password) {
  if (!username || !password) return false;
  const users = getConfiguredUsers();
  const expectedHash = users[username];
  if (typeof expectedHash !== "string" || expectedHash.length === 0) {
    return false;
  }

  const actualHash = hashPassword(password);
  return timingSafeEqualString(actualHash, expectedHash);
}

export function listConfiguredUsernames() {
  return Object.keys(getConfiguredUsers());
}

export function createSessionToken(username) {
  const payload = {
    username,
    exp: Date.now() + MAX_AGE_SECONDS * 1000,
  };
  const encodedPayload = base64url(JSON.stringify(payload));
  const signature = sign(encodedPayload);
  return `${encodedPayload}.${signature}`;
}

function shouldUseSecureCookie(req) {
  if (process.env.NODE_ENV === "production") return true;
  const proto = req.headers?.["x-forwarded-proto"];
  return proto === "https";
}

export function parseSession(req) {
  const token = parseCookies(req)[SESSION_COOKIE_NAME];
  if (!token || typeof token !== "string") return null;

  const [encodedPayload, signature] = token.split(".");
  if (!encodedPayload || !signature) return null;
  if (!timingSafeEqualString(signature, sign(encodedPayload))) return null;

  try {
    const parsed = JSON.parse(fromBase64url(encodedPayload).toString("utf8"));
    if (!parsed || typeof parsed !== "object") return null;
    if (typeof parsed.username !== "string" || typeof parsed.exp !== "number") {
      return null;
    }
    if (Date.now() > parsed.exp) return null;
    return { username: parsed.username };
  } catch {
    return null;
  }
}

export function setSessionCookie(req, res, username) {
  const token = createSessionToken(username);
  const parts = [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${MAX_AGE_SECONDS}`,
  ];
  if (shouldUseSecureCookie(req)) parts.push("Secure");
  const cookie = parts.join("; ");
  res.setHeader("Set-Cookie", cookie);
}

export function clearSessionCookie(req, res) {
  const parts = [
    `${SESSION_COOKIE_NAME}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0",
  ];
  if (shouldUseSecureCookie(req)) parts.push("Secure");
  const cookie = parts.join("; ");
  res.setHeader("Set-Cookie", cookie);
}
