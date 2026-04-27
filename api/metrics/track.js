import crypto from "node:crypto";
import { readMetricsState, writeMetricsState } from "./_store.js";

function hashVisitorId(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const visitorId =
    typeof req.body?.visitorId === "string" ? req.body.visitorId.trim() : "";

  if (!visitorId) {
    res.status(400).json({ error: "visitorId krävs" });
    return;
  }

  const state = await readMetricsState();
  const key = hashVisitorId(visitorId);

  state.pageViews += 1;
  state.visitors[key] = { lastSeenAt: Date.now() };
  state.updatedAt = new Date().toISOString();

  await writeMetricsState(state);

  res.status(200).json({ ok: true });
}
