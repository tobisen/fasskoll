export default async function handler(req, res) {
  const endpoint = req.query?.endpoint;

  if (!endpoint || typeof endpoint !== "string") {
    res.status(400).json({ error: "Missing endpoint query parameter" });
    return;
  }

  if (!endpoint.startsWith("https://cms.fass.se/api/vard/")) {
    res.status(400).json({ error: "Endpoint not allowed" });
    return;
  }

  try {
    const upstreamUrl = `https://fass.se/api/content?endpoint=${encodeURIComponent(endpoint)}`;

    const upstream = await fetch(upstreamUrl, {
      method: req.method,
      headers: {
        accept: req.headers.accept || "*/*",
        "accept-language": req.headers["accept-language"] || "sv-SE,sv;q=0.9,en-US;q=0.8,en;q=0.7",
        "content-type": req.headers["content-type"] || "text/plain;charset=UTF-8",
        referer: "https://fass.se/health/pharmacy-stock-status",
        origin: "https://fass.se",
        "user-agent": req.headers["user-agent"] || "Mozilla/5.0",
      },
      body: req.method === "GET" || req.method === "HEAD" ? undefined : JSON.stringify(req.body),
      cache: "no-store",
    });

    const contentType = upstream.headers.get("content-type") || "application/json; charset=utf-8";
    const text = await upstream.text();

    res.status(upstream.status);
    res.setHeader("content-type", contentType);
    res.send(text);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown proxy error";
    res.status(502).json({ error: message });
  }
}
