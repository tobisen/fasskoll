<script setup lang="ts">
import { onMounted, ref, watch } from "vue";
import { useRoute } from "vue-router";
import {
  geocodeZip,
  getInterchangeablePackages,
  getPackage,
  getPharmaciesWithStock,
  searchDrug,
  type FormStrengthOption,
  type Pharmacy,
  type SearchDrugItem,
} from "../api/fassClient";

const props = withDefaults(defineProps<{ isLoggedIn?: boolean; currentUsername?: string }>(), {
  isLoggedIn: false,
  currentUsername: "",
});

const DEFAULT_PACKAGE_ID = "";
const DEFAULT_ZIP_CODE = "75318";

const route = useRoute();
const zipCode = ref(DEFAULT_ZIP_CODE);
const packageId = ref(DEFAULT_PACKAGE_ID);
const formStrengthOptions = ref<FormStrengthOption[]>([]);
const loading = ref(false);
const error = ref("");
const hasSearched = ref(false);
const rows = ref<
  Array<{
    key: string;
    pharmacy: Pharmacy;
    strengthLabel: string;
    packageType: string;
    stockInformation: string;
    inStock: boolean;
  }>
>([]);
const allRows = ref<
  Array<{
    key: string;
    pharmacy: Pharmacy;
    strengthLabel: string;
    packageType: string;
    stockInformation: string;
    inStock: boolean;
  }>
>([]);
const loadingOptions = ref(false);
const selectedStockFilter = ref("IN_STOCK");
const unavailableStrengths = ref<string[]>([]);
const medicineQuery = ref("");
const selectedMedicineLabel = ref("");
const loadingMedicineSearch = ref(false);
const selectedRadiusKm = ref(10);
const searchCenter = ref<{ latitude: number; longitude: number } | null>(null);
const PUBLIC_MEDICINES = new Set(["estradot", "lenzetto", "divigel", "estrogel"]);
const infoMessage = ref("");

const STOCK_GROUP_LABELS: Record<string, string> = {
  IN_STOCK: "I lager",
  OUT_OF_STOCK: "Ej i lager",
  CONTACT_PHARMACY: "Kontakta apotek",
};

function stockGroup(code: string): "IN_STOCK" | "OUT_OF_STOCK" | "CONTACT_PHARMACY" {
  if (code === "IN_STOCK" || code === "FEW_IN_STOCK") {
    return "IN_STOCK";
  }

  if (code === "NOT_IN_STOCK_SHORTAGE_INFO" || code === "NO_SERVICE") {
    return "OUT_OF_STOCK";
  }

  return "CONTACT_PHARMACY";
}

function stockLabel(code: string): string {
  return STOCK_GROUP_LABELS[stockGroup(code)];
}

function optionDisplayLabel(option: FormStrengthOption): string {
  return option.manufacturer ? `${option.label} ${option.manufacturer}` : option.label;
}

function pickStringCandidate(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function packageIdFromSearchItem(item: SearchDrugItem): string | null {
  const direct = [
    item.packageId,
    item.id,
    item.nplPackId,
    item.nplId,
  ].find((candidate) => typeof candidate === "string" && candidate.trim().length > 0);

  if (typeof direct === "string") {
    return direct.trim();
  }

  const obj = item as Record<string, unknown>;
  const nestedCandidates = [obj.package, obj.packaging, obj.medicinalProductPackage];
  for (const nested of nestedCandidates) {
    if (!nested || typeof nested !== "object") {
      continue;
    }
    const nestedObj = nested as Record<string, unknown>;
    const nestedId = pickStringCandidate(
      nestedObj.packageId ?? nestedObj.id ?? nestedObj.nplPackId ?? nestedObj.nplId,
    );
    if (nestedId) {
      return nestedId;
    }
  }

  return null;
}

function labelFromSearchItem(item: SearchDrugItem): string {
  return (
    pickStringCandidate(item.tradeName) ??
    pickStringCandidate(item.name) ??
    packageIdFromSearchItem(item) ??
    "Okänt läkemedel"
  );
}

function packageTypeFromStrengthLabel(label: string): string {
  const cleaned = label.trim();
  if (!cleaned) {
    return "-";
  }

  const beforeNumber = cleaned.split(/\d/)[0]?.trim();
  if (beforeNumber) {
    return beforeNumber;
  }

  const firstWord = cleaned.split(/\s+/)[0]?.trim();
  return firstWord || "-";
}

function findFirstTextDeep(raw: unknown, keys: string[]): string | null {
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
      const value = obj[key];
      if (typeof value === "string" && value.trim().length > 0) {
        return value.trim();
      }
    }

    for (const value of Object.values(obj)) {
      queue.push(value);
    }
  }

  return null;
}

async function createFallbackOptionFromPackage(packageIdValue: string): Promise<FormStrengthOption> {
  const pkg = await getPackage(packageIdValue);
  const form =
    findFirstTextDeep(pkg, [
      "pharmaceuticalForm",
      "pharmaceuticalFormName",
      "pharmaceuticalFormText",
      "form",
      "dosageForm",
    ]) ?? "Läkemedelsform";
  const strength =
    findFirstTextDeep(pkg, ["strength", "strengthText", "strengthLabel", "dosage"]) ??
    "Styrka";
  const manufacturer =
    findFirstTextDeep(pkg, [
      "marketingCompany",
      "manufacturer",
      "companyName",
      "marketingAuthorizationHolder",
    ]) ?? undefined;

  return {
    id: `${packageIdValue}:fallback`,
    label: `${form} ${strength}`,
    form,
    strength,
    manufacturer,
    packageId: packageIdValue,
  };
}

function filteredResults() {
  if (selectedStockFilter.value === "ALL") {
    return rows.value;
  }
  return rows.value.filter(
    (item) => stockGroup(item.stockInformation) === selectedStockFilter.value,
  );
}

function hasResultsInOtherFilters(): boolean {
  return rows.value.length > 0 && filteredResults().length === 0;
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

function pharmacyCoordinates(pharmacy: Pharmacy): { latitude: number; longitude: number } | null {
  const latitude = toNumber((pharmacy as Record<string, unknown>).latitude)
    ?? toNumber((pharmacy as Record<string, unknown>).lat);
  const longitude = toNumber((pharmacy as Record<string, unknown>).longitude)
    ?? toNumber((pharmacy as Record<string, unknown>).lng)
    ?? toNumber((pharmacy as Record<string, unknown>).lon);

  if (latitude === null || longitude === null) {
    return null;
  }

  return { latitude, longitude };
}

function distanceKm(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
): number {
  const toRadians = (deg: number) => (deg * Math.PI) / 180;
  const earthRadiusKm = 6371;
  const dLat = toRadians(b.latitude - a.latitude);
  const dLon = toRadians(b.longitude - a.longitude);
  const lat1 = toRadians(a.latitude);
  const lat2 = toRadians(b.latitude);

  const h =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return 2 * earthRadiusKm * Math.asin(Math.sqrt(h));
}

function applyRadiusFilter(
  inputRows: Array<{
    key: string;
    pharmacy: Pharmacy;
    strengthLabel: string;
    packageType: string;
    stockInformation: string;
    inStock: boolean;
  }>,
): Array<{
  key: string;
  pharmacy: Pharmacy;
  strengthLabel: string;
  packageType: string;
  stockInformation: string;
  inStock: boolean;
}> {
  if (!searchCenter.value) {
    return inputRows;
  }

  return inputRows.filter((row) => {
    const coords = pharmacyCoordinates(row.pharmacy);
    if (!coords) {
      return false;
    }
    return distanceKm(searchCenter.value as { latitude: number; longitude: number }, coords) <= selectedRadiusKm.value;
  });
}

function toFormStrengthOption(pkgObj: Record<string, unknown>, fallbackId: string): FormStrengthOption {
  const packId =
    (typeof pkgObj.nplPackId === "string" && pkgObj.nplPackId.trim()) ||
    (typeof pkgObj.id === "string" && pkgObj.id.trim()) ||
    (typeof pkgObj.packageId === "string" && pkgObj.packageId.trim()) ||
    (typeof pkgObj.nplId === "string" && pkgObj.nplId.trim()) ||
    fallbackId;

  const form =
    (typeof pkgObj.doseForm === "string" && pkgObj.doseForm.trim()) ||
    (typeof pkgObj.pharmaceuticalForm === "string" && pkgObj.pharmaceuticalForm.trim()) ||
    undefined;
  const strength =
    (typeof pkgObj.strengthAndUnit === "string" && pkgObj.strengthAndUnit.trim()) ||
    (typeof pkgObj.strength === "string" && pkgObj.strength.trim()) ||
    undefined;
  const manufacturer =
    (typeof pkgObj.companyName === "string" && pkgObj.companyName.trim()) ||
    undefined;
  const packageType =
    (typeof pkgObj.packagingName === "string" && pkgObj.packagingName.trim()) ||
    (typeof pkgObj.container === "string" && pkgObj.container.trim()) ||
    undefined;

  const labelParts = [form, strength].filter((part): part is string => Boolean(part));
  const label = labelParts.length > 0 ? labelParts.join(" ") : packId;

  return {
    id: `${packId}:${label}`,
    label,
    form,
    strength,
    manufacturer,
    packageType,
    packageId: packId,
  };
}

async function loadFormStrengthOptions(sourcePackageIds: string[]) {
  loadingOptions.value = true;
  try {
    const sourceIds = Array.from(new Set(sourcePackageIds.map((id) => id.trim()).filter(Boolean)));
    const resolved: FormStrengthOption[] = [];

    for (const sourceId of sourceIds) {
      const interchangeable = await getInterchangeablePackages(sourceId);
      for (const pkg of interchangeable) {
        resolved.push(toFormStrengthOption(pkg as Record<string, unknown>, sourceId));
      }
    }

    const uniqueByPackId = new Map<string, FormStrengthOption>();
    for (const option of resolved) {
      if (!uniqueByPackId.has(option.packageId)) {
        uniqueByPackId.set(option.packageId, option);
      }
    }

    formStrengthOptions.value = Array.from(uniqueByPackId.values())
      .sort((a, b) => a.label.localeCompare(b.label, "sv"));

    if (formStrengthOptions.value.length === 0) {
      const fallbackBaseId = sourceIds[0] ?? packageId.value.trim();
      const fallback = await createFallbackOptionFromPackage(fallbackBaseId);
      formStrengthOptions.value = [fallback];
    }

    if (formStrengthOptions.value.length > 0) {
      const exactPackageMatch = formStrengthOptions.value.find(
        (option) => option.packageId === packageId.value.trim(),
      );

      if (exactPackageMatch) {
        packageId.value = exactPackageMatch.packageId;
      } else {
        packageId.value = formStrengthOptions.value[0].packageId;
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Okänt fel";
    error.value = `Kunde inte hämta läkemedelsformer/styrkor: ${message}`;
  } finally {
    loadingOptions.value = false;
  }
}

async function handleMedicineSearch() {
  const normalizedQuery = medicineQuery.value.trim().toLowerCase();
  const guestAllowedMedicine = PUBLIC_MEDICINES.has(normalizedQuery);

  if (!props.isLoggedIn && !guestAllowedMedicine) {
    error.value =
      "Logga in för att söka valfria läkemedel. Estradot, Lenzetto, Divigel och Estrogel är tillgängliga utan inloggning.";
    return;
  }

  if (!medicineQuery.value.trim()) {
    error.value = "Skriv ett läkemedelsnamn.";
    return;
  }

  loadingMedicineSearch.value = true;
  error.value = "";
  selectedMedicineLabel.value = "";

  try {
    const rawResults = await searchDrug(medicineQuery.value.trim());
    const normalized = rawResults
      .map((item) => {
        const selectedPackageId = packageIdFromSearchItem(item);
        if (!selectedPackageId) {
          return null;
        }
        return {
          packageId: selectedPackageId,
          label: labelFromSearchItem(item),
        };
      })
      .filter((item): item is { packageId: string; label: string } => item !== null);

    const unique = new Map<string, { packageId: string; label: string }>();
    for (const item of normalized) {
      if (!unique.has(item.packageId)) {
        unique.set(item.packageId, item);
      }
    }

    const candidates = Array.from(unique.values()).slice(0, 20);

    if (candidates.length === 0) {
      error.value = "Inga läkemedel hittades för sökningen.";
      return;
    }

    const first = candidates[0];
    const normalizedFirstLabel = first.label.trim().toLowerCase();
    const relatedSourceIds = candidates
      .filter((item) => item.label.trim().toLowerCase() === normalizedFirstLabel)
      .map((item) => item.packageId);

    await selectMedicine(first, relatedSourceIds);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Okänt fel";
    error.value = `Kunde inte söka läkemedel: ${message}`;
  } finally {
    loadingMedicineSearch.value = false;
  }
}

async function selectMedicine(
  item: { packageId: string; label: string },
  relatedSourceIds: string[] = [],
) {
  const sourceIds = Array.from(new Set([item.packageId, ...relatedSourceIds]));
  packageId.value = sourceIds[0];
  medicineQuery.value = item.label;
  selectedMedicineLabel.value = sourceIds.length > 1
    ? `${item.label} (${sourceIds.length} varianter)`
    : item.label;
  hasSearched.value = false;
  rows.value = [];
  unavailableStrengths.value = [];
  await loadFormStrengthOptions(sourceIds);
  await checkStock();
}

async function checkStock() {
  hasSearched.value = true;

  if (!formStrengthOptions.value.length && !packageId.value.trim()) {
    error.value = "Sök och välj ett läkemedel först.";
    return;
  }

  if (!zipCode.value.trim()) {
    error.value = "Ange postnummer.";
    return;
  }

  loading.value = true;
  error.value = "";
  infoMessage.value = "";
  unavailableStrengths.value = [];

  const optionsToCheck = formStrengthOptions.value.length > 0
    ? formStrengthOptions.value
    : [
        {
          id: `${packageId.value.trim()}:fallback`,
          label: packageId.value.trim(),
          packageId: packageId.value.trim(),
        } as FormStrengthOption,
      ];

  try {
    try {
      const geocode = await geocodeZip(zipCode.value.trim());
      searchCenter.value = {
        latitude: geocode.latitude,
        longitude: geocode.longitude,
      };
    } catch {
      searchCenter.value = null;
    }

    const variants = optionsToCheck.map((option) => ({
      packageId: option.packageId,
      strengthLabel: optionDisplayLabel(option),
      packageType: option.packageType ?? packageTypeFromStrengthLabel(optionDisplayLabel(option)),
    }));

    const response = await fetch("/api/stock", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        zipCode: zipCode.value.trim(),
        variants,
      }),
      cache: "no-store",
    });

    if (!response.ok) {
      const details = await response
        .json()
        .then((json) => (typeof json?.error === "string" ? json.error : "Okänt fel"))
        .catch(() => "Okänt fel");
      throw new Error(details);
    }

    const payload = await response.json();
    const incomingRows = Array.isArray(payload?.rows) ? payload.rows : [];
    allRows.value = incomingRows;
    rows.value = applyRadiusFilter(allRows.value);
    unavailableStrengths.value = Array.isArray(payload?.unavailableStrengths)
      ? payload.unavailableStrengths
      : [];

    if (payload?.degraded === true || payload?.staleFallback === true) {
      infoMessage.value =
        "Fass svarar inte fullt ut just nu. Visar senast tillgängliga cachedata.";
    }
  } catch (primaryError) {
    const builtRows: Array<{
      key: string;
      pharmacy: Pharmacy;
      strengthLabel: string;
      packageType: string;
      stockInformation: string;
      inStock: boolean;
    }> = [];

    const failedStrengths: string[] = [];

    for (const option of optionsToCheck) {
      try {
        const packageRows = await getPharmaciesWithStock({
          packageId: option.packageId,
          zipCode: zipCode.value.trim(),
          limit: 60,
        });

        for (const item of packageRows) {
          builtRows.push({
            key: `${item.pharmacy.glnCode}-${option.id}`,
            pharmacy: item.pharmacy,
            strengthLabel: optionDisplayLabel(option),
            packageType: option.packageType ?? packageTypeFromStrengthLabel(optionDisplayLabel(option)),
            stockInformation: item.stock?.stockInformation ?? "UNKNOWN",
            inStock: item.inStock,
          });
        }
      } catch {
        failedStrengths.push(optionDisplayLabel(option));
      }
    }

    allRows.value = builtRows;
    rows.value = applyRadiusFilter(allRows.value);
    unavailableStrengths.value = failedStrengths;

    if (builtRows.length > 0) {
      infoMessage.value =
        "Fass svarade inte fullt ut. Visar fallbackdata från reservflödet.";
    } else {
      const details =
        primaryError instanceof Error ? primaryError.message : "Okänt fel från Fass";
      error.value = `Kunde inte hämta lagerstatus just nu: ${details}`;
    }
  }

  finally {
    loading.value = false;
  }
}

async function applyPrefillFromRouteQuery() {
  const queryMedicine = route.query.medicine;
  const queryPackageId = route.query.packageId;
  const queryZipCode = route.query.zipCode;
  const queryAutostart = route.query.autostart;

  if (typeof queryMedicine === "string" && queryMedicine.trim()) {
    const requestedMedicine = queryMedicine.trim();
    const isPublicMedicine = PUBLIC_MEDICINES.has(requestedMedicine.toLowerCase());

    if (props.isLoggedIn || isPublicMedicine) {
      medicineQuery.value = requestedMedicine;
      if (queryAutostart === "1") {
        await handleMedicineSearch();
        return;
      }
    }
  } else if (!props.isLoggedIn) {
    medicineQuery.value = "Estradot";
  }

  if (typeof queryPackageId === "string" && queryPackageId.trim()) {
    packageId.value = queryPackageId.trim();
  }

  if (typeof queryZipCode === "string" && queryZipCode.trim()) {
    zipCode.value = queryZipCode.trim();
  }

  hasSearched.value = false;
  rows.value = [];
  allRows.value = [];
  unavailableStrengths.value = [];
}

onMounted(async () => {
  await applyPrefillFromRouteQuery();
});

watch(
  () => route.query,
  async () => {
    await applyPrefillFromRouteQuery();
  },
);

watch(selectedRadiusKm, () => {
  rows.value = applyRadiusFilter(allRows.value);
});
</script>

<template>
  <section class="search-page">
    <header class="page-header">
      <p class="eyebrow">Fasskoll Regionläge</p>
      <h1>Sök lagerstatus</h1>
      <p>Liveöversikt över apoteksstatus för Estradot, Lenzetto, Divigel och Estrogel, med fokus på tillgängliga alternativ.</p>
    </header>

    <p v-if="loadingOptions" class="info">Laddar läkemedelsformer och styrkor...</p>

    <div class="controls-card">
      <template v-if="props.isLoggedIn">
        <label for="medicine">Läkemedel</label>
        <div class="medicine-search-row">
          <input
            id="medicine"
            v-model="medicineQuery"
            type="text"
            placeholder="t.ex. Estradot"
            @keyup.enter="handleMedicineSearch"
          />
          <button type="button" :disabled="loadingMedicineSearch || loadingOptions" @click="handleMedicineSearch">
            {{ loadingMedicineSearch ? "Söker..." : "Sök läkemedel" }}
          </button>
        </div>
      </template>
      <div v-else class="info">
        Publikt läge: <strong>Estradot</strong>, <strong>Lenzetto</strong>, <strong>Divigel</strong> och <strong>Estrogel</strong> är tillgängliga utan inloggning.
      </div>

      <p v-if="selectedMedicineLabel" class="medicine-results">
        Vald träff: <strong>{{ selectedMedicineLabel }}</strong>
      </p>

      <label for="zip">Postnummer</label>
      <input id="zip" v-model="zipCode" type="text" placeholder="t.ex. 11122" />

      <label for="radius">Sökradie</label>
      <select id="radius" v-model.number="selectedRadiusKm">
        <option :value="10">10 km</option>
        <option :value="20">20 km</option>
        <option :value="30">30 km</option>
        <option :value="40">40 km</option>
        <option :value="50">50 km</option>
      </select>

      <div>
        <button type="button" :disabled="loading" @click="checkStock">
          {{ loading ? "Laddar..." : "Sök lagerstatus" }}
        </button>
      </div>

      <p v-if="error" class="error-text">{{ error }}</p>
      <p v-if="!error && infoMessage" class="warn-text">{{ infoMessage }}</p>
      <p v-if="!error && unavailableStrengths.length > 0" class="warn-text">
        Ingen data just nu för: {{ unavailableStrengths.join(", ") }}
      </p>

      <label for="stock-filter">Filtrera status</label>
      <select id="stock-filter" v-model="selectedStockFilter">
        <option value="ALL">Alla statusar</option>
        <option value="IN_STOCK">I lager</option>
        <option value="OUT_OF_STOCK">Ej i lager</option>
        <option value="CONTACT_PHARMACY">Kontakta apotek</option>
      </select>
    </div>

    <div v-if="filteredResults().length > 0" class="table-wrapper">
      <table>
        <thead>
          <tr>
            <th>Apotek</th>
            <th>Styrka</th>
            <th>Förpackningstyp</th>
            <th>Adress</th>
            <th>Lagerstatus</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="item in filteredResults()"
            :key="item.key"
          >
            <td>{{ item.pharmacy.name ?? "Okänt apotek" }}</td>
            <td>{{ item.strengthLabel }}</td>
            <td>{{ item.packageType }}</td>
            <td>
              {{
                item.pharmacy.visitingAddress
                  ? `${item.pharmacy.visitingAddress.streetAddress}, ${item.pharmacy.visitingAddress.postalCode} ${item.pharmacy.visitingAddress.city}`
                  : "Adress saknas"
              }}
            </td>
            <td>{{ stockLabel(item.stockInformation) }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <p v-else-if="!loading && rows.length > 0" class="info">
      Inga apotek matchar valt filter.
    </p>
    <p v-if="!loading && hasResultsInOtherFilters()" class="info">
      Tips: välj <strong>Kontakta apotek</strong> eller <strong>Alla statusar</strong>.
    </p>
    <p v-else-if="!loading && hasSearched" class="info">
      Inga träffar för vald sökning (eller tillfälligt tomt svar från Fass).
    </p>
    <p v-else-if="!loading" class="info">Ange postnummer och klicka på Sök lagerstatus.</p>
  </section>
</template>

<style scoped>
.search-page {
  max-width: 1200px;
  margin: 0 auto;
}

.page-header {
  margin-bottom: 1rem;
}

.page-header h1 {
  margin: 0;
  font-size: clamp(1.9rem, 4vw, 2.6rem);
  letter-spacing: -0.02em;
}

.page-header p {
  margin: 0.35rem 0 0;
  color: var(--muted);
}

.eyebrow {
  margin: 0 0 0.25rem;
  color: var(--primary);
  text-transform: uppercase;
  font-weight: 700;
  letter-spacing: 0.08em;
  font-size: 0.8rem;
}

.controls-card {
  padding: 1rem;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--surface);
  box-shadow: var(--shadow);
}

label {
  display: block;
  margin-top: 0.75rem;
  margin-bottom: 0.25rem;
  font-weight: 600;
}

input {
  width: 100%;
  max-width: 360px;
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 0.6rem 0.75rem;
  background: var(--surface-strong);
}

select {
  width: 100%;
  max-width: 360px;
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 0.6rem 0.75rem;
  background: var(--surface-strong);
}

button {
  margin-top: 0.8rem;
  border: none;
  border-radius: 10px;
  padding: 0.7rem 1rem;
  background: linear-gradient(135deg, var(--primary) 0%, var(--primary-strong) 100%);
  color: #fff;
  font-weight: 600;
  cursor: pointer;
}

.medicine-search-row {
  display: flex;
  gap: 0.6rem;
  align-items: center;
}

.medicine-search-row input {
  max-width: none;
}

.medicine-search-row button {
  margin-top: 0;
  white-space: nowrap;
}

.medicine-results {
  margin-top: 0.75rem;
  font-size: 0.9rem;
  color: var(--muted);
}

.table-wrapper {
  margin-top: 1rem;
  overflow-x: auto;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--surface-strong);
  box-shadow: var(--shadow);
}

table {
  width: 100%;
  border-collapse: collapse;
}

th,
td {
  text-align: left;
  padding: 0.8rem;
  border-bottom: 1px solid var(--line);
}

th {
  background: var(--bg-soft);
  font-size: 0.9rem;
  letter-spacing: 0.01em;
}

tbody tr:hover {
  background: #f2f8ff;
}

.error-text {
  color: var(--danger);
  margin-top: 0.6rem;
}

.warn-text {
  color: var(--warn);
  margin-top: 0.6rem;
}

.info {
  color: var(--muted);
  margin-top: 0.8rem;
}

@media (max-width: 760px) {
  .controls-card {
    padding: 0.9rem;
  }

  th,
  td {
    padding: 0.65rem;
    font-size: 0.95rem;
  }
}

</style>
