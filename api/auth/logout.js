import { clearSessionCookie, isTrustedSameOriginRequest } from "./_session.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  if (!isTrustedSameOriginRequest(req)) {
    res.status(403).json({ error: "Ogiltigt origin-header." });
    return;
  }

  clearSessionCookie(req, res);
  res.status(200).json({ ok: true });
}
