import type { FormStrengthOption, Pharmacy } from "./fassTypes";

function toText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
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

export function extractFormStrengthOptions(raw: unknown): FormStrengthOption[] {
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

export function needsFriendlyLabel(option: FormStrengthOption): boolean {
  const normalized = option.label.trim().toLowerCase();
  return (
    normalized === option.packageId.toLowerCase() ||
    normalized === "okänd" ||
    /^\d+$/.test(normalized)
  );
}

export function enrichOptionFromPackageDetails(
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

export function pickCoordinates(raw: unknown): { latitude: number; longitude: number } {
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

export function pickGlnCode(pharmacy: Pharmacy): string | null {
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

export function normalizeStockInfoToInStock(stockInformation: string | undefined): boolean {
  return stockInformation === "IN_STOCK" || stockInformation === "FEW_IN_STOCK";
}

