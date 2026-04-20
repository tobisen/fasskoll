<script setup lang="ts">
import { onMounted, ref, watch } from "vue";
import { useRoute } from "vue-router";
import {
  getInterchangeablePackages,
  getPackage,
  getPharmaciesWithStock,
  type FormStrengthOption,
  type Pharmacy,
} from "../api/fassClient";

const DEFAULT_PACKAGE_ID = "20040607005750";
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
const loadingOptions = ref(false);
const selectedStockFilter = ref("IN_STOCK");
const unavailableStrengths = ref<string[]>([]);

const ESTRADOT_VARIANTS: Array<{
  nplId: string;
  strength: string;
  form: string;
  manufacturer: string;
}> = [
  { nplId: "20040607005750", strength: "25 mikrog/24 timmar", form: "Depotplåster", manufacturer: "Sandoz AS" },
  { nplId: "20011130000246", strength: "37,5 mikrog/24 timmar", form: "Depotplåster", manufacturer: "Sandoz AS" },
  { nplId: "20011130000253", strength: "50 mikrog/24 timmar", form: "Depotplåster", manufacturer: "Sandoz AS" },
  { nplId: "20011130000260", strength: "75 mikrog/24 timmar", form: "Depotplåster", manufacturer: "Sandoz AS" },
  { nplId: "20011130000277", strength: "100 mikrog/24 timmar", form: "Depotplåster", manufacturer: "Sandoz AS" },
];

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

function isCodeLike(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.length === 0 || /^\d{6,}$/.test(trimmed);
}

function buildFriendlyStrengthFromPackage(rawPackage: unknown): string | null {
  const form =
    findFirstTextDeep(rawPackage, [
      "pharmaceuticalForm",
      "pharmaceuticalFormName",
      "pharmaceuticalFormText",
      "pharmaceuticalFormDescription",
      "form",
      "formText",
      "dosageForm",
      "dosageFormText",
      "drugForm",
    ]) ?? "";
  const strength =
    findFirstTextDeep(rawPackage, [
      "strength",
      "strengthText",
      "strengthLabel",
      "strengthDescription",
      "dosage",
      "dosageText",
      "activeSubstanceStrength",
    ]) ?? "";
  const manufacturer =
    findFirstTextDeep(rawPackage, [
      "marketingCompany",
      "manufacturer",
      "companyName",
      "marketingAuthorizationHolder",
      "holder",
      "company",
    ]) ?? "";
  const fallbackTitle =
    findFirstTextDeep(rawPackage, [
      "displayName",
      "packageName",
      "name",
      "title",
      "medicinalProductName",
      "tradeName",
    ]) ?? "";

  const main = [form, strength].filter((part) => part.length > 0).join(" ");
  const fullBase = main.length > 0 ? main : fallbackTitle;
  const full = [fullBase, manufacturer].filter((part) => part.length > 0).join(" ");
  return full.trim() || null;
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

function normalizeKeyName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[åä]/g, "a")
    .replace(/ö/g, "o")
    .replace(/[^a-z0-9]/g, "");
}

function findFirstTextDeepByKeyTokens(raw: unknown, tokens: string[]): string | null {
  const normalizedTokens = tokens.map((token) => normalizeKeyName(token));
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
    for (const [key, value] of Object.entries(obj)) {
      const normalizedKey = normalizeKeyName(key);
      const matchesToken = normalizedTokens.some((token) => normalizedKey.includes(token));
      if (matchesToken && typeof value === "string" && value.trim().length > 0) {
        return value.trim();
      }
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function loadFormStrengthOptions(basePackageId: string) {
  loadingOptions.value = true;
  try {
    const resolved: FormStrengthOption[] = [];
    for (const variant of ESTRADOT_VARIANTS) {
      try {
        const packages = await getInterchangeablePackages(variant.nplId);
        const chosen =
          packages.find((pkg) => (pkg as Record<string, unknown>).isOnTheMarket === true) ??
          packages[0];
        const chosenObj = (chosen ?? {}) as Record<string, unknown>;
        const nplPackId =
          (typeof chosenObj.nplPackId === "string" && chosenObj.nplPackId) ||
          variant.nplId;
        const packageType =
          (typeof chosenObj.packagingName === "string" && chosenObj.packagingName) ||
          (typeof chosenObj.container === "string" && chosenObj.container) ||
          undefined;

        resolved.push({
          id: `${nplPackId}:${variant.form} ${variant.strength}`,
          label: `${variant.form} ${variant.strength}`,
          form: variant.form,
          strength: variant.strength,
          manufacturer: variant.manufacturer,
          packageType,
          packageId: nplPackId,
        });
      } catch {
        resolved.push({
          id: `${variant.nplId}:${variant.form} ${variant.strength}`,
          label: `${variant.form} ${variant.strength}`,
          form: variant.form,
          strength: variant.strength,
          manufacturer: variant.manufacturer,
          packageId: variant.nplId,
        });
      }
    }

    formStrengthOptions.value = resolved.sort((a, b) => a.label.localeCompare(b.label, "sv"));

    if (formStrengthOptions.value.length === 0) {
      const fallback = await createFallbackOptionFromPackage(basePackageId.trim());
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

async function checkStock() {
  hasSearched.value = true;

  if (!zipCode.value.trim()) {
    error.value = "Ange postnummer.";
    return;
  }

  loading.value = true;
  error.value = "";
  unavailableStrengths.value = [];

  try {
    const optionsToCheck = formStrengthOptions.value.length > 0
      ? formStrengthOptions.value
      : [
          {
            id: `${packageId.value.trim()}:fallback`,
            label: packageId.value.trim(),
            packageId: packageId.value.trim(),
          } as FormStrengthOption,
        ];

    const uniquePackageIds = Array.from(
      new Set(optionsToCheck.map((option) => option.packageId)),
    );

    const packageTypeByPackageId = new Map<string, string>();
    const strengthLabelByPackageId = new Map<string, string>();
    await Promise.all(
      optionsToCheck.map(async (option) => {
        const baseLabel = optionDisplayLabel(option);
        if (!isCodeLike(baseLabel)) {
          strengthLabelByPackageId.set(option.packageId, baseLabel);
        }

        if (option.packageType && option.packageType.trim()) {
          packageTypeByPackageId.set(option.packageId, option.packageType);
          if (!isCodeLike(baseLabel)) return;
        }

        try {
          const pkg = await getPackage(option.packageId);
          const friendlyStrength = buildFriendlyStrengthFromPackage(pkg);
          const looseStrength =
            findFirstTextDeepByKeyTokens(pkg, ["styrka", "strength", "dosage"]) ??
            findFirstTextDeepByKeyTokens(pkg, ["lakemedelsform", "pharmaceuticalform"]);
          const bestStrength =
            (friendlyStrength && !isCodeLike(friendlyStrength) ? friendlyStrength : null) ??
            (looseStrength && !isCodeLike(looseStrength) ? looseStrength : null);
          if (bestStrength) {
            strengthLabelByPackageId.set(option.packageId, bestStrength);
          }

          const fromDetails =
            findFirstTextDeep(pkg, [
              "packageType",
              "packageTypeText",
              "packageTypeName",
              "packageDescription",
              "packageName",
              "packageSize",
              "packSize",
              "packagingType",
              "packagingTypeText",
              "packageText",
              "containerType",
              "packaging",
            ]) ??
            findFirstTextDeepByKeyTokens(pkg, ["forpackning", "package", "packaging", "container"]) ??
            "-";
          packageTypeByPackageId.set(option.packageId, fromDetails);

          if (!strengthLabelByPackageId.has(option.packageId)) {
            const nameLike =
              findFirstTextDeep(pkg, [
                "displayName",
                "name",
                "title",
                "medicinalProductName",
                "tradeName",
              ]) ?? findFirstTextDeepByKeyTokens(pkg, ["name", "title"]);
            if (nameLike && !isCodeLike(nameLike)) {
              strengthLabelByPackageId.set(option.packageId, nameLike);
            }
          }
        } catch {
          packageTypeByPackageId.set(option.packageId, "-");
          if (!strengthLabelByPackageId.has(option.packageId)) {
            const fallbackFromOption = optionDisplayLabel(option);
            strengthLabelByPackageId.set(
              option.packageId,
              isCodeLike(fallbackFromOption) ? "Styrka saknas i källa" : fallbackFromOption,
            );
          }
        }
      }),
    );

    const packageResults: Array<{ packageId: string; rows: Awaited<ReturnType<typeof getPharmaciesWithStock>> }> = [];
    let successfulRequests = 0;
    const failedPackages: Array<{ packageId: string; reason: string }> = [];
    for (const packageIdValue of uniquePackageIds) {
      try {
        const packageRows = await getPharmaciesWithStock({
          packageId: packageIdValue,
          zipCode: zipCode.value.trim(),
          limit: 60,
        });
        successfulRequests += 1;
        packageResults.push({
          packageId: packageIdValue,
          rows: packageRows,
        });
      } catch (err) {
        const reason = err instanceof Error ? err.message : "Okänt fel";
        failedPackages.push({ packageId: packageIdValue, reason });
        // Skip one variant if Fass rejects it temporarily; keep partial results.
        packageResults.push({
          packageId: packageIdValue,
          rows: [],
        });
      }

      // Small delay to reduce upstream rate-limit/anti-bot triggers.
      await sleep(220);
    }

    if (successfulRequests === 0) {
      const details = failedPackages
        .slice(0, 3)
        .map((f) => `${f.packageId}: ${f.reason}`)
        .join(" | ");
      throw new Error(
        `Kunde inte hämta data för någon styrka just nu.${details ? ` (${details})` : ""}`,
      );
    }
    const unavailableByPackage = new Set(failedPackages.map((f) => f.packageId));
    unavailableStrengths.value = optionsToCheck
      .filter((option) => unavailableByPackage.has(option.packageId))
      .map((option) => optionDisplayLabel(option));

    const builtRows: Array<{
      key: string;
      pharmacy: Pharmacy;
      strengthLabel: string;
      packageType: string;
      stockInformation: string;
      inStock: boolean;
    }> = [];

    for (const option of optionsToCheck) {
      const matchingPackageRows =
        packageResults.find((entry) => entry.packageId === option.packageId)?.rows ?? [];
      const strengthLabel =
        strengthLabelByPackageId.get(option.packageId) ??
        (isCodeLike(optionDisplayLabel(option))
          ? "Styrka saknas i källa"
          : optionDisplayLabel(option));
      const packageTypeRaw = packageTypeByPackageId.get(option.packageId) ?? "-";
      const packageType =
        packageTypeRaw !== "-" && !isCodeLike(packageTypeRaw)
          ? packageTypeRaw
          : (() => {
              const inferred = packageTypeFromStrengthLabel(strengthLabel);
              return inferred === "-" ? "Förpackning saknas i källa" : inferred;
            })();
      for (const item of matchingPackageRows) {
        const stockInformation = item.stock?.stockInformation ?? "UNKNOWN";
        builtRows.push({
          key: `${item.pharmacy.glnCode}-${option.id}`,
          pharmacy: item.pharmacy,
          strengthLabel: isCodeLike(optionDisplayLabel(option))
            ? strengthLabel
            : optionDisplayLabel(option),
          packageType,
          stockInformation,
          inStock: item.inStock,
        });
      }
    }

    rows.value = builtRows;

  } catch (err) {
    const message = err instanceof Error ? err.message : "Okänt fel";
    error.value = `Kunde inte hämta lagerstatus: ${message}`;
  } finally {
    loading.value = false;
  }
}

async function applyPrefillFromRouteQuery() {
  const queryPackageId = route.query.packageId;
  const queryZipCode = route.query.zipCode;
  const queryAutostart = route.query.autostart;

  if (typeof queryPackageId === "string" && queryPackageId.trim()) {
    packageId.value = queryPackageId.trim();
    await loadFormStrengthOptions(packageId.value);
  }

  if (typeof queryZipCode === "string" && queryZipCode.trim()) {
    zipCode.value = queryZipCode.trim();
  }

  if (queryAutostart === "1") {
    await checkStock();
  }
}

onMounted(async () => {
  await loadFormStrengthOptions(packageId.value);
  await applyPrefillFromRouteQuery();
  if (!hasSearched.value) {
    await checkStock();
  }
});

watch(
  () => route.query,
  async () => {
    await applyPrefillFromRouteQuery();
  },
);
</script>

<template>
  <section class="search-page">
    <header class="page-header">
      <p class="eyebrow">Fasskoll Regionläge</p>
      <h1>Sök lagerstatus</h1>
      <p>Liveöversikt över apoteksstatus för Estradot, med fokus på tillgängliga alternativ.</p>
    </header>

    <p v-if="loadingOptions" class="info">Laddar läkemedelsformer och styrkor...</p>

    <div class="controls-card">
      <label for="zip">Postnummer</label>
      <input id="zip" v-model="zipCode" type="text" placeholder="t.ex. 11122" />

      <div>
        <button type="button" :disabled="loading" @click="checkStock">
          {{ loading ? "Laddar..." : "Sök lagerstatus" }}
        </button>
      </div>

      <p v-if="error" class="error-text">{{ error }}</p>
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
    <p v-else-if="!loading && (hasSearched || zipCode.trim().length > 0)" class="info">
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
