export interface SearchDrugItem {
  id?: string;
  name?: string;
  tradeName?: string;
  [key: string]: unknown;
}

export interface PackageDetails {
  id?: string;
  [key: string]: unknown;
}

export interface InterchangeableMedicinalProduct {
  [key: string]: unknown;
}

export interface InterchangeablePackage {
  [key: string]: unknown;
}

export interface FormStrengthOption {
  id: string;
  label: string;
  strength?: string;
  form?: string;
  manufacturer?: string;
  packageType?: string;
  packageId: string;
}

export interface GeocodeResult {
  latitude: number;
  longitude: number;
  raw: unknown;
}

export interface Pharmacy {
  glnCode: string;
  name?: string;
  address?: string;
  chainName?: string;
  visitingAddress?: {
    streetAddress?: string;
    city?: string;
    postalCode?: string;
  };
  latitude?: number;
  longitude?: number;
  [key: string]: unknown;
}

export interface StockItem {
  exchangeableProductInStock?: boolean;
  glnCode: string;
  stockInformation: string;
  [key: string]: unknown;
}

export interface PharmacyWithStock {
  pharmacy: Pharmacy;
  stock: StockItem | null;
  inStock: boolean;
}

export interface NearbyPharmacyParams {
  latitude: number;
  longitude: number;
  limit?: number;
}

export interface PharmaciesWithStockParams {
  packageId: string;
  zipCode: string;
  limit?: number;
}

const CMS_BASE = "https://cms.fass.se/api/vard";

function buildProxyUrl(endpoint: string): string {
  return `/api/content?endpoint=${encodeURIComponent(endpoint)}`;
}

async function parseErrorMessage(response: Response): Promise<string> {
  try {
    const text = await response.text();
    if (text) {
      const lower = text.toLowerCase();
      if (lower.includes("<html") || lower.includes("<!doctype html")) {
        if (lower.includes("fass kan för närvarande inte nås")) {
          return "Fass är tillfälligt otillgängligt just nu. Försök igen om en stund.";
        }
        return "Fass svarade med en HTML-felsida istället för JSON.";
      }
      return text.slice(0, 300);
    }
  } catch {
    // ignore read errors
  }
  return `${response.status} ${response.statusText}`;
}

async function getViaProxy<T>(endpoint: string): Promise<T> {
  const response = await fetch(buildProxyUrl(endpoint), {
    cache: "no-store",
    headers: {
      Accept: "*/*",
    },
  });

  if (!response.ok) {
    const details = await parseErrorMessage(response);
    throw new Error(`GET failed: ${details}`);
  }

  return (await response.json()) as T;
}

async function postViaProxy<T>(endpoint: string, body: unknown): Promise<T> {
  const response = await fetch(buildProxyUrl(endpoint), {
    method: "POST",
    cache: "no-store",
    headers: {
      Accept: "*/*",
      "Content-Type": "text/plain;charset=UTF-8",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const details = await parseErrorMessage(response);
    throw new Error(`POST failed: ${details}`);
  }

  return (await response.json()) as T;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function normalizeStockInfoToInStock(stockInformation: string | undefined): boolean {
  return stockInformation === "IN_STOCK" || stockInformation === "FEW_IN_STOCK";
}

function toText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function pickFirstTextDeep(raw: unknown, keys: string[]): string | null {
  const queue: unknown[] = [raw];
  const visited = new Set<object>();

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || typeof current !== "object") {
      continue;
    }

    const ref = current as object;
    if (visited.has(ref)) {
      continue;
    }
    visited.add(ref);

    if (Array.isArray(current)) {
      for (const item of current) {
        queue.push(item);
      }
      continue;
    }

    const obj = current as Record<string, unknown>;
    for (const key of keys) {
      const value = toText(obj[key]);
      if (value) {
        return value;
      }
    }

    for (const value of Object.values(obj)) {
      queue.push(value);
    }
  }

  return null;
}

function pickFirstText(obj: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = toText(obj[key]);
    if (value) {
      return value;
    }
  }
  return null;
}

function pickPackageId(obj: Record<string, unknown>): string | null {
  const direct = pickFirstText(obj, [
    "packageId",
    "packageID",
    "id",
    "nplPackId",
    "nplId",
  ]);
  if (direct) {
    return direct;
  }

  const nestedCandidates = [obj.package, obj.packaging, obj.medicinalProductPackage];
  for (const nested of nestedCandidates) {
    if (!nested || typeof nested !== "object") {
      continue;
    }
    const nestedObj = nested as Record<string, unknown>;
    const nestedId = pickFirstText(nestedObj, [
      "packageId",
      "packageID",
      "id",
      "nplPackId",
      "nplId",
    ]);
    if (nestedId) {
      return nestedId;
    }
  }

  return null;
}

function buildFormStrengthOption(obj: Record<string, unknown>): FormStrengthOption | null {
  const packageId = pickPackageId(obj);
  if (!packageId) {
    return null;
  }

  const form = pickFirstText(obj, [
    "pharmaceuticalForm",
    "form",
    "drugForm",
    "dosageForm",
    "formText",
    "pharmaceuticalFormName",
    "pharmaceuticalFormText",
  ]);
  const strength = pickFirstText(obj, [
    "strength",
    "strengthText",
    "dosage",
    "strengthLabel",
    "strengthDescription",
  ]);
  const manufacturer = pickFirstText(obj, [
    "marketingCompany",
    "manufacturer",
    "companyName",
    "holder",
    "marketingAuthorizationHolder",
  ]);
  const packageType = pickFirstText(obj, [
    "packageType",
    "packageTypeText",
    "packageDescription",
    "packageName",
    "packaging",
    "packageSize",
    "packSize",
    "containerType",
  ]);

  const fallbackName = pickFirstText(obj, [
    "name",
    "tradeName",
    "displayName",
    "label",
    "packageName",
    "medicinalProductName",
  ]);
  const labelParts = [form, strength].filter((part): part is string => Boolean(part));
  const label = labelParts.length > 0 ? labelParts.join(" ") : fallbackName ?? packageId;

  return {
    id: `${packageId}:${label}`,
    label,
    strength: strength ?? undefined,
    form: form ?? undefined,
    manufacturer: manufacturer ?? undefined,
    packageType: packageType ?? undefined,
    packageId,
  };
}

function needsFriendlyLabel(option: FormStrengthOption): boolean {
  const normalized = option.label.trim().toLowerCase();
  return (
    normalized === option.packageId.toLowerCase() ||
    normalized === "okänd" ||
    /^\d+$/.test(normalized)
  );
}

function enrichOptionFromPackageDetails(
  option: FormStrengthOption,
  rawPackage: unknown,
): FormStrengthOption {
  const form =
    pickFirstTextDeep(rawPackage, [
      "pharmaceuticalForm",
      "pharmaceuticalFormName",
      "pharmaceuticalFormText",
      "form",
      "drugForm",
      "dosageForm",
    ]) ?? option.form;
  const strength =
    pickFirstTextDeep(rawPackage, [
      "strength",
      "strengthText",
      "strengthLabel",
      "dosage",
      "strengthDescription",
    ]) ?? option.strength;
  const manufacturer =
    pickFirstTextDeep(rawPackage, [
      "marketingCompany",
      "manufacturer",
      "companyName",
      "marketingAuthorizationHolder",
      "holder",
    ]) ?? option.manufacturer;
  const packageType =
    pickFirstTextDeep(rawPackage, [
      "packageType",
      "packageTypeText",
      "packageDescription",
      "packageName",
      "packageSize",
      "packSize",
      "containerType",
      "packaging",
    ]) ?? option.packageType;

  const labelParts = [form, strength].filter((part): part is string => Boolean(part));
  const fallbackName = pickFirstTextDeep(rawPackage, [
    "displayName",
    "packageName",
    "name",
    "tradeName",
    "medicinalProductName",
  ]);

  const label =
    labelParts.length > 0
      ? labelParts.join(" ")
      : fallbackName ?? option.label ?? option.packageId;

  return {
    ...option,
    label,
    form,
    strength,
    manufacturer,
    packageType,
  };
}

function extractFormStrengthOptions(raw: unknown): FormStrengthOption[] {
  const queue: unknown[] = [raw];
  const visited = new Set<object>();
  const options: FormStrengthOption[] = [];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || typeof current !== "object") {
      continue;
    }

    const ref = current as object;
    if (visited.has(ref)) {
      continue;
    }
    visited.add(ref);

    if (Array.isArray(current)) {
      for (const item of current) {
        queue.push(item);
      }
      continue;
    }

    const obj = current as Record<string, unknown>;
    const option = buildFormStrengthOption(obj);
    if (option) {
      options.push(option);
    }

    for (const value of Object.values(obj)) {
      queue.push(value);
    }
  }

  const unique = new Map<string, FormStrengthOption>();
  for (const option of options) {
    const dedupeKey = `${option.packageId}|${option.label}`;
    if (!unique.has(dedupeKey)) {
      unique.set(dedupeKey, option);
    }
  }

  return Array.from(unique.values()).sort((a, b) => a.label.localeCompare(b.label, "sv"));
}

function pickGlnCode(pharmacy: Pharmacy): string | null {
  const rawCandidates: unknown[] = [
    pharmacy.glnCode,
    pharmacy.gln,
    pharmacy.glncode,
    pharmacy.gln_number,
  ];

  for (const candidate of rawCandidates) {
    if (typeof candidate !== "string") {
      continue;
    }

    const normalized = candidate.replace(/\s+/g, "");
    if (/^\d{8,}$/.test(normalized)) {
      return normalized;
    }
  }

  return null;
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number(value.replace(",", "."));
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return null;
}

function readCoordsFromObject(
  obj: Record<string, unknown>,
): { latitude: number; longitude: number } | null {
  const latitude = toNumber(obj.latitude) ?? toNumber(obj.lat);
  const longitude =
    toNumber(obj.longitude) ?? toNumber(obj.lng) ?? toNumber(obj.lon);

  if (latitude !== null && longitude !== null) {
    return { latitude, longitude };
  }

  const center = Array.isArray(obj.center) ? obj.center : null;
  if (center && center.length >= 2) {
    const centerLongitude = toNumber(center[0]);
    const centerLatitude = toNumber(center[1]);
    if (centerLatitude !== null && centerLongitude !== null) {
      return { latitude: centerLatitude, longitude: centerLongitude };
    }
  }

  const geometry =
    obj.geometry && typeof obj.geometry === "object"
      ? (obj.geometry as Record<string, unknown>)
      : null;
  const coordinates =
    geometry && Array.isArray(geometry.coordinates) ? geometry.coordinates : null;
  if (coordinates && coordinates.length >= 2) {
    const coordLongitude = toNumber(coordinates[0]);
    const coordLatitude = toNumber(coordinates[1]);
    if (coordLatitude !== null && coordLongitude !== null) {
      return { latitude: coordLatitude, longitude: coordLongitude };
    }
  }

  return null;
}

function pickCoordinates(raw: unknown): { latitude: number; longitude: number } {
  const queue: unknown[] = [raw];
  const visited = new Set<object>();

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || typeof current !== "object") {
      continue;
    }

    const objectRef = current as object;
    if (visited.has(objectRef)) {
      continue;
    }
    visited.add(objectRef);

    if (Array.isArray(current)) {
      for (const item of current) {
        queue.push(item);
      }
      continue;
    }

    const candidate = current as Record<string, unknown>;
    const directMatch = readCoordsFromObject(candidate);
    if (directMatch) {
      return directMatch;
    }

    for (const value of Object.values(candidate)) {
      queue.push(value);
    }
  }

  throw new Error("Could not parse latitude/longitude from geocode response");
}

export async function searchDrug(query: string): Promise<SearchDrugItem[]> {
  const endpoint = `${CMS_BASE}/medicinal-product/search/trade-name/${encodeURIComponent(query)}`;
  const data = await getViaProxy<unknown>(endpoint);
  return Array.isArray(data) ? (data as SearchDrugItem[]) : [];
}

export async function getPackage(packageId: string): Promise<PackageDetails> {
  const endpoint = `${CMS_BASE}/package/${encodeURIComponent(packageId)}?isParallellImported=false`;
  return getViaProxy<PackageDetails>(endpoint);
}

export async function getInterchangeableMedicinalProduct(
  packageId: string,
): Promise<InterchangeableMedicinalProduct> {
  const endpoint = `${CMS_BASE}/interchangeable-medicinal-product/${encodeURIComponent(packageId)}`;
  return getViaProxy<InterchangeableMedicinalProduct>(endpoint);
}

export async function getInterchangeablePackages(
  packageId: string,
): Promise<InterchangeablePackage[]> {
  const endpoint = `${CMS_BASE}/package/interchangeable/${encodeURIComponent(packageId)}?isParallellImported=false`;
  const data = await getViaProxy<unknown>(endpoint);
  return Array.isArray(data) ? (data as InterchangeablePackage[]) : [];
}

export async function getFormStrengthOptions(
  packageId: string,
): Promise<FormStrengthOption[]> {
  const medicinalRaw = await getViaProxy<unknown>(
    `${CMS_BASE}/interchangeable-medicinal-product/${encodeURIComponent(packageId)}`,
  );
  const fromMedicinal = extractFormStrengthOptions(medicinalRaw);

  const packagesRaw = await getViaProxy<unknown>(
    `${CMS_BASE}/package/interchangeable/${encodeURIComponent(packageId)}?isParallellImported=false`,
  );
  const fromPackages = extractFormStrengthOptions(packagesRaw);

  const combined = [...fromMedicinal, ...fromPackages];
  const uniqueByLabel = new Map<string, FormStrengthOption>();
  for (const option of combined) {
    const key = `${option.label}|${option.manufacturer ?? ""}`;
    if (!uniqueByLabel.has(key)) {
      uniqueByLabel.set(key, option);
    }
  }
  const baseOptions = Array.from(uniqueByLabel.values());

  const enriched = await Promise.all(
    baseOptions.map(async (option) => {
      if (!needsFriendlyLabel(option)) {
        return option;
      }

      try {
        const details = await getPackage(option.packageId);
        return enrichOptionFromPackageDetails(option, details);
      } catch {
        return option;
      }
    }),
  );

  return enriched.sort((a, b) => a.label.localeCompare(b.label, "sv"));
}

export async function geocodeZip(zipCode: string): Promise<GeocodeResult> {
  const endpoint = `${CMS_BASE}/geocode/reverse?address=${encodeURIComponent(zipCode)}`;
  const raw = await getViaProxy<unknown>(endpoint);
  const { latitude, longitude } = pickCoordinates(raw);

  return {
    latitude,
    longitude,
    raw,
  };
}

export async function getNearbyPharmacies({
  latitude,
  longitude,
  limit = 60,
}: NearbyPharmacyParams): Promise<Pharmacy[]> {
  const endpoint = `${CMS_BASE}/pharmacy?longitude=${longitude}&latitude=${latitude}&limit=${limit}`;
  const data = await getViaProxy<unknown>(endpoint);
  return Array.isArray(data) ? (data as Pharmacy[]) : [];
}

export async function getStockStatus(
  packageId: string,
  glnCodes: string[],
): Promise<StockItem[]> {
  const endpoint = `${CMS_BASE}/pharmacy/stock/${encodeURIComponent(packageId)}`;
  const uniqueGlnCodes = Array.from(new Set(glnCodes));
  const maxAttempts = 3;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const data = await postViaProxy<unknown>(endpoint, uniqueGlnCodes);
      return Array.isArray(data) ? (data as StockItem[]) : [];
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const isLastAttempt = attempt === maxAttempts;
      const canRetry = message.includes("tillfälligt otillgängligt");

      if (isLastAttempt || !canRetry) {
        throw error;
      }

      await sleep(400 * attempt);
    }
  }

  return [];
}

export async function getPharmaciesWithStock({
  packageId,
  zipCode,
  limit = 60,
}: PharmaciesWithStockParams): Promise<PharmacyWithStock[]> {
  const geocode = await geocodeZip(zipCode);

  const pharmacies = await getNearbyPharmacies({
    latitude: geocode.latitude,
    longitude: geocode.longitude,
    limit,
  });

  const glnCodes = pharmacies
    .map((pharmacy) => pickGlnCode(pharmacy))
    .filter((glnCode): glnCode is string => Boolean(glnCode));

  if (glnCodes.length === 0) {
    return [];
  }

  let stockItems: StockItem[] = [];
  try {
    stockItems = await getStockStatus(packageId, glnCodes);
  } catch {
    // Upstream stock endpoint can be temporarily blocked/unavailable.
    // Return pharmacies anyway so UI can show fallback status.
    stockItems = [];
  }
  const stockMap = new Map(stockItems.map((item) => [item.glnCode, item]));

  return pharmacies.map((pharmacy) => {
    const stock = stockMap.get(pharmacy.glnCode) ?? null;

    return {
      pharmacy,
      stock,
      inStock: normalizeStockInfoToInStock(stock?.stockInformation),
    };
  });
}
