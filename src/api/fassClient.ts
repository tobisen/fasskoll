import {
  enrichOptionFromPackageDetails,
  extractFormStrengthOptions,
  needsFriendlyLabel,
  normalizeStockInfoToInStock,
  pickCoordinates,
  pickGlnCode,
} from "./fassMappers";
import type {
  FormStrengthOption,
  GeocodeResult,
  InterchangeableMedicinalProduct,
  InterchangeablePackage,
  NearbyPharmacyParams,
  PackageDetails,
  PharmaciesWithStockParams,
  Pharmacy,
  PharmacyWithStock,
  SearchDrugItem,
  StockItem,
} from "./fassTypes";

export type {
  FormStrengthOption,
  GeocodeResult,
  InterchangeableMedicinalProduct,
  InterchangeablePackage,
  NearbyPharmacyParams,
  PackageDetails,
  PharmaciesWithStockParams,
  Pharmacy,
  PharmacyWithStock,
  SearchDrugItem,
  StockItem,
};

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

