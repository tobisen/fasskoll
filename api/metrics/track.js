import crypto from "node:crypto";
import {
  hasKvMetricsConfig,
  kvHIncrBy,
  kvIncrBy,
  kvSet,
  kvSAdd,
  readMetricsState,
  writeMetricsState,
} from "./_store.js";

function hashVisitorId(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function dayKey(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function hourKey(date = new Date()) {
  return date.toISOString().slice(0, 13);
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

  if (hasKvMetricsConfig()) {
    const hashedVisitorId = hashVisitorId(visitorId);
    const nowDate = new Date();
    const dKey = dayKey(nowDate);
    const hKey = hourKey(nowDate);

    await kvIncrBy("pageViews:total", 1);
    await kvHIncrBy("pageViews:day", dKey, 1);
    await kvSAdd("visitors:all", hashedVisitorId);

    const addedInDay = await kvSAdd(`visitors:day:${dKey}`, hashedVisitorId);
    if (addedInDay > 0) {
      await kvHIncrBy("visitors:day", dKey, 1);
      await kvHIncrBy("visitors:hour", hKey, 1);
    }

    await kvSet("updatedAt", new Date().toISOString());
    res.status(200).json({ ok: true });
    return;
  }

  const state = await readMetricsState();
  const key = hashVisitorId(visitorId);
  const now = Date.now();
  const nowDate = new Date(now);
  const dKey = dayKey(nowDate);
  const hKey = hourKey(nowDate);
  const visitorRecord =
    state.visitors[key] && typeof state.visitors[key] === "object" ? state.visitors[key] : {};

  state.pageViews += 1;
  state.visitors[key] = {
    lastSeenAt: now,
    lastSeenDayKey: dKey,
    lastSeenHourKey: hKey,
  };
  state.traffic.pageViewDayBuckets[dKey] =
    (state.traffic.pageViewDayBuckets[dKey] || 0) + 1;
  if (visitorRecord.lastSeenDayKey !== dKey) {
    state.traffic.visitorDayBuckets[dKey] =
      (state.traffic.visitorDayBuckets[dKey] || 0) + 1;
  }
  if (visitorRecord.lastSeenHourKey !== hKey) {
    state.traffic.visitorHourBuckets[hKey] =
      (state.traffic.visitorHourBuckets[hKey] || 0) + 1;
  }
  state.updatedAt = new Date().toISOString();

  await writeMetricsState(state);

  res.status(200).json({ ok: true });
}
