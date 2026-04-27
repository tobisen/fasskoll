import { parseSession } from "../auth/_session.js";
import { readMetricsState } from "./_store.js";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const session = parseSession(req);
  if (!session || session.username !== "admin") {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const state = await readMetricsState();
  const uniqueVisitors = Object.keys(state.visitors || {}).length;

  res.status(200).json({
    uniqueVisitors,
    pageViews: state.pageViews || 0,
    updatedAt: state.updatedAt || null,
    source: "internal",
  });
}

