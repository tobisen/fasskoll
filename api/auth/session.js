import { parseSession } from "./_session.js";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const session = parseSession(req);
  if (!session) {
    res.status(200).json({ authenticated: false });
    return;
  }

  res.status(200).json({ authenticated: true, username: session.username });
}

