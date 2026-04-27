import {
  setSessionCookie,
  verifyCredentials,
} from "./_session.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const username =
    typeof req.body?.username === "string" ? req.body.username.trim() : "";
  const password =
    typeof req.body?.password === "string" ? req.body.password : "";

  if (!verifyCredentials(username, password)) {
    res.status(401).json({ ok: false, error: "Fel användarnamn eller lösenord." });
    return;
  }

  setSessionCookie(req, res, username);
  res.status(200).json({ ok: true, username });
}
