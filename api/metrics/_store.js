import fs from "node:fs/promises";
import path from "node:path";

const METRICS_FILE = path.join("/tmp", "fasskoll-metrics.json");

function initialState() {
  return {
    pageViews: 0,
    visitors: {},
    updatedAt: null,
  };
}

function normalizeState(raw) {
  if (!raw || typeof raw !== "object") return initialState();
  const pageViews = typeof raw.pageViews === "number" ? raw.pageViews : 0;
  const visitors = raw.visitors && typeof raw.visitors === "object" ? raw.visitors : {};
  const updatedAt =
    typeof raw.updatedAt === "string" || raw.updatedAt === null ? raw.updatedAt : null;
  return { pageViews, visitors, updatedAt };
}

export async function readMetricsState() {
  try {
    const raw = await fs.readFile(METRICS_FILE, "utf8");
    return normalizeState(JSON.parse(raw));
  } catch {
    return initialState();
  }
}

export async function writeMetricsState(state) {
  const normalized = normalizeState(state);
  const tmpFile = `${METRICS_FILE}.tmp`;
  await fs.writeFile(tmpFile, JSON.stringify(normalized), "utf8");
  await fs.rename(tmpFile, METRICS_FILE);
}

