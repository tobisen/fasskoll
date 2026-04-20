const CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new Map();

function toNumber(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const n = Number(value.replace(',', '.'));
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function pickCoordinates(raw) {
  const queue = [raw];
  const visited = new Set();
  while (queue.length) {
    const current = queue.shift();
    if (!current || typeof current !== 'object') continue;
    if (visited.has(current)) continue;
    visited.add(current);

    if (Array.isArray(current)) {
      for (const item of current) queue.push(item);
      continue;
    }

    const lat = toNumber(current.latitude) ?? toNumber(current.lat);
    const lng = toNumber(current.longitude) ?? toNumber(current.lng) ?? toNumber(current.lon);
    if (lat !== null && lng !== null) return { latitude: lat, longitude: lng };

    if (Array.isArray(current.center) && current.center.length >= 2) {
      const clng = toNumber(current.center[0]);
      const clat = toNumber(current.center[1]);
      if (clat !== null && clng !== null) return { latitude: clat, longitude: clng };
    }

    if (current.geometry && Array.isArray(current.geometry.coordinates) && current.geometry.coordinates.length >= 2) {
      const glng = toNumber(current.geometry.coordinates[0]);
      const glat = toNumber(current.geometry.coordinates[1]);
      if (glat !== null && glng !== null) return { latitude: glat, longitude: glng };
    }

    for (const v of Object.values(current)) queue.push(v);
  }
  throw new Error('Kunde inte tolka koordinater.');
}

function stockGroup(code) {
  if (code === 'IN_STOCK' || code === 'FEW_IN_STOCK') return 'IN_STOCK';
  if (code === 'NOT_IN_STOCK_SHORTAGE_INFO' || code === 'NO_SERVICE') return 'OUT_OF_STOCK';
  return 'CONTACT_PHARMACY';
}

async function fetchFass(endpoint, method = 'GET', body) {
  const url = `https://fass.se/api/content?endpoint=${encodeURIComponent(endpoint)}`;
  const res = await fetch(url, {
    method,
    headers: {
      accept: '*/*',
      'accept-language': 'sv-SE,sv;q=0.9,en-US;q=0.8,en;q=0.7',
      'content-type': 'text/plain;charset=UTF-8',
      referer: 'https://fass.se/health/pharmacy-stock-status',
      origin: 'https://fass.se',
      'user-agent': 'Mozilla/5.0',
    },
    body: method === 'GET' ? undefined : JSON.stringify(body),
    cache: 'no-store',
  });

  const text = await res.text();
  if (!res.ok) throw new Error(`Fass svarade ${res.status}`);
  if (text.trim().startsWith('<!doctype html') || text.trim().startsWith('<html')) {
    throw new Error('Fass returnerade HTML istället för JSON');
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('Ogiltigt JSON-svar från Fass');
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const zipCode = req.body?.zipCode;
  const variants = Array.isArray(req.body?.variants) ? req.body.variants : [];

  if (!zipCode || variants.length === 0) {
    res.status(400).json({ error: 'zipCode och variants krävs' });
    return;
  }

  const cacheKey = `${zipCode}|${variants.map((v) => v.packageId).join(',')}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    res.status(200).json({ ...cached.data, cached: true });
    return;
  }

  try {
    const geocode = await fetchFass(`https://cms.fass.se/api/vard/geocode/reverse?address=${encodeURIComponent(zipCode)}`);
    const { latitude, longitude } = pickCoordinates(geocode);

    const pharmacies = await fetchFass(
      `https://cms.fass.se/api/vard/pharmacy?longitude=${longitude}&latitude=${latitude}&limit=60`
    );

    const list = Array.isArray(pharmacies) ? pharmacies : [];
    const glnCodes = list.map((p) => p?.glnCode).filter((x) => typeof x === 'string' && x.length > 0);

    const rows = [];
    const unavailableStrengths = [];

    for (const variant of variants) {
      const pkgId = variant.packageId;
      let stock = [];
      try {
        const s = await fetchFass(`https://cms.fass.se/api/vard/pharmacy/stock/${encodeURIComponent(pkgId)}`, 'POST', glnCodes);
        stock = Array.isArray(s) ? s : [];
      } catch {
        unavailableStrengths.push(variant.strengthLabel || pkgId);
      }

      const stockMap = new Map(stock.map((s) => [s.glnCode, s]));
      for (const p of list) {
        const s = stockMap.get(p.glnCode);
        const stockInformation = s?.stockInformation || 'UNKNOWN';
        rows.push({
          key: `${p.glnCode}-${pkgId}`,
          pharmacy: p,
          strengthLabel: variant.strengthLabel || pkgId,
          packageType: variant.packageType || '-',
          stockInformation,
          inStock: stockGroup(stockInformation) === 'IN_STOCK',
        });
      }

      await sleep(220);
    }

    const data = { rows, unavailableStrengths };
    cache.set(cacheKey, { ts: Date.now(), data });
    res.status(200).json(data);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Okänt fel';
    res.status(502).json({ error: message });
  }
}
