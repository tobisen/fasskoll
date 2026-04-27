import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import crypto from "node:crypto";

const DEV_SESSION_COOKIE_NAME = "fasskoll_session";
const DEV_DEFAULT_USERS: Record<string, string> = {
  "Jenny&Tobbe":
    "220f24a42a45b1490ee59ada37b9f6232dccc3cd28b1d6ba43e16c6a561935f2",
  admin:
    "cf44996d6a28ef5dfec3b4a3a9076a4e385400ce8688ff93f3b887f9c4ea26b0",
};
const DEV_PASSWORD_SALT = process.env.AUTH_PASSWORD_SALT || "fasskoll-v1-salt";
const DEV_SESSION_SECRET =
  process.env.AUTH_SESSION_SECRET || "change-me-in-vercel-env";
const DEV_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;
const devMetricsState: {
  pageViews: number;
  visitors: Record<string, true>;
  updatedAt: string | null;
} = {
  pageViews: 0,
  visitors: {},
  updatedAt: null,
};

function getDevUsers() {
  if (process.env.AUTH_USERS_JSON) {
    try {
      const parsed = JSON.parse(process.env.AUTH_USERS_JSON) as Record<string, unknown>;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, string>;
      }
    } catch {
      // fall through
    }
  }

  if (process.env.AUTH_USERNAME && process.env.AUTH_PASSWORD_HASH) {
    return { [process.env.AUTH_USERNAME]: process.env.AUTH_PASSWORD_HASH };
  }

  return DEV_DEFAULT_USERS;
}

function base64url(input: Buffer | string) {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function fromBase64url(input: string) {
  const b64 = input.replace(/-/g, "+").replace(/_/g, "/");
  const pad = b64.length % 4;
  const normalized = pad ? b64 + "=".repeat(4 - pad) : b64;
  return Buffer.from(normalized, "base64");
}

function sign(value: string) {
  return base64url(
    crypto.createHmac("sha256", DEV_SESSION_SECRET).update(value).digest(),
  );
}

function parseCookieHeader(raw?: string) {
  const out: Record<string, string> = {};
  if (!raw) return out;
  for (const part of raw.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (!key) continue;
    out[key] = decodeURIComponent(rest.join("="));
  }
  return out;
}

function verifyCredentials(username: string, password: string) {
  if (!username || !password) return false;
  const users = getDevUsers();
  const expected = users[username];
  if (!expected) return false;
  const actual = crypto
    .pbkdf2Sync(password, DEV_PASSWORD_SALT, 210000, 32, "sha256")
    .toString("hex");
  const a = Buffer.from(actual);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function hashVisitorId(value: string) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function parseSession(req: import("http").IncomingMessage) {
  const cookie = parseCookieHeader(req.headers.cookie)[DEV_SESSION_COOKIE_NAME];
  if (!cookie) return null;
  const [payloadEncoded, signature] = cookie.split(".");
  if (!payloadEncoded || !signature) return null;
  const sigA = Buffer.from(signature);
  const sigB = Buffer.from(sign(payloadEncoded));
  if (sigA.length !== sigB.length || !crypto.timingSafeEqual(sigA, sigB)) return null;

  try {
    const payload = JSON.parse(fromBase64url(payloadEncoded).toString("utf8")) as {
      username?: string;
      exp?: number;
    };
    if (!payload?.username || typeof payload.exp !== "number") return null;
    if (Date.now() > payload.exp) return null;
    return { username: payload.username };
  } catch {
    return null;
  }
}

function setSessionCookie(
  res: import("http").ServerResponse,
  username: string,
) {
  const payload = base64url(
    JSON.stringify({ username, exp: Date.now() + DEV_MAX_AGE_SECONDS * 1000 }),
  );
  const token = `${payload}.${sign(payload)}`;
  res.setHeader(
    "Set-Cookie",
    [
      `${DEV_SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
      "Path=/",
      "HttpOnly",
      "SameSite=Lax",
      `Max-Age=${DEV_MAX_AGE_SECONDS}`,
    ].join("; "),
  );
}

function clearSessionCookie(res: import("http").ServerResponse) {
  res.setHeader(
    "Set-Cookie",
    [
      `${DEV_SESSION_COOKIE_NAME}=`,
      "Path=/",
      "HttpOnly",
      "SameSite=Lax",
      "Max-Age=0",
    ].join("; "),
  );
}

function sendJson(res: import("http").ServerResponse, status: number, payload: unknown) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

function readJsonBody(req: import("http").IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
    });
    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        resolve({});
      }
    });
  });
}

const devAuthPlugin = {
  name: "dev-auth-routes",
  configureServer(server: import("vite").ViteDevServer) {
    server.middlewares.use("/api/content", async (req, res) => {
      const method = req.method || "GET";
      const url = new URL(req.url || "/", "http://localhost");
      const endpoint = url.searchParams.get("endpoint");

      if (!endpoint || !endpoint.startsWith("https://cms.fass.se/api/vard/")) {
        sendJson(res, 400, { error: "Endpoint not allowed" });
        return;
      }

      try {
        const upstreamUrl = `https://fass.se/api/content?endpoint=${encodeURIComponent(endpoint)}`;
        const body = method === "GET" || method === "HEAD" ? undefined : await readJsonBody(req);

        const upstream = await fetch(upstreamUrl, {
          method,
          headers: {
            accept: req.headers.accept || "*/*",
            "accept-language":
              req.headers["accept-language"] || "sv-SE,sv;q=0.9,en-US;q=0.8,en;q=0.7",
            "content-type":
              req.headers["content-type"] || "text/plain;charset=UTF-8",
            referer: "https://fass.se/health/pharmacy-stock-status",
            origin: "https://fass.se",
            "user-agent": req.headers["user-agent"] || "Mozilla/5.0",
          },
          body:
            method === "GET" || method === "HEAD" || body === undefined
              ? undefined
              : JSON.stringify(body),
          cache: "no-store",
        });

        const text = await upstream.text();
        res.statusCode = upstream.status;
        res.setHeader(
          "content-type",
          upstream.headers.get("content-type") || "application/json; charset=utf-8",
        );
        res.end(text);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown proxy error";
        sendJson(res, 502, { error: message });
      }
    });

    server.middlewares.use("/api/auth/session", (req, res) => {
      if (req.method !== "GET") {
        sendJson(res, 405, { error: "Method not allowed" });
        return;
      }
      const session = parseSession(req);
      if (!session) {
        sendJson(res, 200, { authenticated: false });
        return;
      }
      sendJson(res, 200, { authenticated: true, username: session.username });
    });

    server.middlewares.use("/api/auth/login", async (req, res) => {
      if (req.method !== "POST") {
        sendJson(res, 405, { error: "Method not allowed" });
        return;
      }

      const body = await readJsonBody(req);
      const username = typeof body.username === "string" ? body.username.trim() : "";
      const password = typeof body.password === "string" ? body.password : "";

      if (!verifyCredentials(username, password)) {
        sendJson(res, 401, { ok: false, error: "Fel användarnamn eller lösenord." });
        return;
      }

      setSessionCookie(res, username);
      sendJson(res, 200, { ok: true, username });
    });

    server.middlewares.use("/api/auth/logout", (req, res) => {
      if (req.method !== "POST") {
        sendJson(res, 405, { error: "Method not allowed" });
        return;
      }
      clearSessionCookie(res);
      sendJson(res, 200, { ok: true });
    });

    server.middlewares.use("/api/metrics/track", async (req, res) => {
      if (req.method !== "POST") {
        sendJson(res, 405, { error: "Method not allowed" });
        return;
      }

      const body = await readJsonBody(req);
      const visitorId = typeof body.visitorId === "string" ? body.visitorId.trim() : "";
      if (!visitorId) {
        sendJson(res, 400, { error: "visitorId krävs" });
        return;
      }

      const key = hashVisitorId(visitorId);
      devMetricsState.pageViews += 1;
      devMetricsState.visitors[key] = true;
      devMetricsState.updatedAt = new Date().toISOString();
      sendJson(res, 200, { ok: true });
    });

    server.middlewares.use("/api/metrics/summary", (req, res) => {
      if (req.method !== "GET") {
        sendJson(res, 405, { error: "Method not allowed" });
        return;
      }

      const session = parseSession(req);
      if (!session || session.username !== "admin") {
        sendJson(res, 403, { error: "Forbidden" });
        return;
      }

      sendJson(res, 200, {
        uniqueVisitors: Object.keys(devMetricsState.visitors).length,
        pageViews: devMetricsState.pageViews,
        updatedAt: devMetricsState.updatedAt,
        source: "internal-dev",
      });
    });
  },
};

export default defineConfig({
  plugins: [devAuthPlugin, vue()],
});
