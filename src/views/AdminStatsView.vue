<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";

const props = withDefaults(defineProps<{ isLoggedIn?: boolean; currentUsername?: string }>(), {
  isLoggedIn: false,
  currentUsername: "",
});

type PeriodKey = "day" | "week" | "month" | "year";
type PeriodMetric = {
  requests: number;
  pageViews: number;
  errors: number;
  uniqueVisitors: number;
  peakRpm: number;
  avgPerDay: number;
  days: number;
};

type Buckets = {
  minute: Record<string, number>;
  day: Record<string, number>;
  visitorHours: Record<string, number>;
  visitorDays: Record<string, number>;
  errorMinutes: Record<string, number>;
  errorsByDay: Record<string, number>;
};

const isAdmin = computed(() => props.isLoggedIn && props.currentUsername === "admin");
const loading = ref(false);
const error = ref("");
const selectedPeriod = ref<PeriodKey>("day");
const totalUniqueVisitors = ref(0);
const totalPageViews = ref(0);
const totalErrors = ref(0);
const periodStats = ref<Record<PeriodKey, PeriodMetric>>({
  day: { requests: 0, pageViews: 0, errors: 0, uniqueVisitors: 0, peakRpm: 0, avgPerDay: 0, days: 1 },
  week: { requests: 0, pageViews: 0, errors: 0, uniqueVisitors: 0, peakRpm: 0, avgPerDay: 0, days: 7 },
  month: { requests: 0, pageViews: 0, errors: 0, uniqueVisitors: 0, peakRpm: 0, avgPerDay: 0, days: 30 },
  year: { requests: 0, pageViews: 0, errors: 0, uniqueVisitors: 0, peakRpm: 0, avgPerDay: 0, days: 365 },
});
const buckets = ref<Buckets>({
  minute: {},
  day: {},
  visitorHours: {},
  visitorDays: {},
  errorMinutes: {},
  errorsByDay: {},
});

const selectedPeriodStats = computed(() => periodStats.value[selectedPeriod.value]);
const chartMax = (values: number[]) => Math.max(1, ...values);
const barHeightPercent = (value: number, max: number) => {
  if (!Number.isFinite(value) || value <= 0) return "0%";
  return `${Math.max(4, Math.round((value / max) * 100))}%`;
};
const safeNumber = (value: unknown) => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
};

function parseBucketDate(raw: string): Date | null {
  const localFirst = new Date(raw);
  if (!Number.isNaN(localFirst.getTime())) return localFirst;
  const utcFallback = new Date(`${raw}Z`);
  if (!Number.isNaN(utcFallback.getTime())) return utcFallback;
  return null;
}

function ymd(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function buildDayByHour(source: Record<string, number>) {
  const now = new Date();
  const labels = Array.from({ length: 24 }, (_, h) => `${String(h).padStart(2, "0")}:00`);
  const values = Array.from({ length: 24 }, () => 0);
  for (const [minuteKey, count] of Object.entries(source || {})) {
    const d = parseBucketDate(`${minuteKey}:00`);
    if (!d) continue;
    if (d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate()) {
      values[d.getHours()] += safeNumber(count);
    }
  }
  return { labels, values };
}

function buildWeekByDay(source: Record<string, number>) {
  const now = new Date();
  const start = new Date(now);
  const day = (now.getDay() + 6) % 7;
  start.setHours(0, 0, 0, 0);
  start.setDate(now.getDate() - day);
  const labels = ["Mån", "Tis", "Ons", "Tor", "Fre", "Lör", "Sön"];
  const values = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return safeNumber(source[ymd(d)]);
  });
  return { labels, values };
}

function buildMonthByWeek(source: Record<string, number>) {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const monthStart = new Date(year, month, 1);
  const offset = (monthStart.getDay() + 6) % 7;
  const weekValues: number[] = [];
  for (let d = 1; d <= daysInMonth; d += 1) {
    const current = new Date(year, month, d);
    const weekIndex = Math.floor((offset + d - 1) / 7);
    while (weekValues.length <= weekIndex) weekValues.push(0);
    weekValues[weekIndex] += safeNumber(source[ymd(current)]);
  }
  return { labels: weekValues.map((_, i) => `Vecka ${i + 1}`), values: weekValues };
}

function buildYearByMonth(source: Record<string, number>) {
  const now = new Date();
  const year = now.getFullYear();
  const labels = ["Jan", "Feb", "Mar", "Apr", "Maj", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dec"];
  const values = Array.from({ length: 12 }, () => 0);
  for (const [dayKey, count] of Object.entries(source || {})) {
    const d = parseBucketDate(`${dayKey}T00:00:00`);
    if (!d) continue;
    if (d.getFullYear() === year) values[d.getMonth()] += safeNumber(count);
  }
  return { labels, values };
}

const reqDay = computed(() => buildDayByHour(buckets.value.minute));
const reqWeek = computed(() => buildWeekByDay(buckets.value.day));
const reqMonth = computed(() => buildMonthByWeek(buckets.value.day));
const reqYear = computed(() => buildYearByMonth(buckets.value.day));

const visitorsDay = computed(() => buildDayByHour(buckets.value.visitorHours));
const visitorsWeek = computed(() => buildWeekByDay(buckets.value.visitorDays));
const visitorsMonth = computed(() => buildMonthByWeek(buckets.value.visitorDays));
const visitorsYear = computed(() => buildYearByMonth(buckets.value.visitorDays));

const errorsDay = computed(() => buildDayByHour(buckets.value.errorMinutes));
const errorsWeek = computed(() => buildWeekByDay(buckets.value.errorsByDay));
const errorsMonth = computed(() => buildMonthByWeek(buckets.value.errorsByDay));
const errorsYear = computed(() => buildYearByMonth(buckets.value.errorsByDay));

async function loadSummary() {
  if (!isAdmin.value) return;
  loading.value = true;
  error.value = "";
  try {
    const response = await fetch("/api/metrics/summary", { method: "GET", credentials: "include", cache: "no-store" });
    if (!response.ok) throw new Error(response.status === 403 ? "Saknar behörighet." : "Kunde inte läsa statistik.");
    const payload = await response.json();
    totalUniqueVisitors.value = safeNumber(payload?.uniqueVisitors);
    totalPageViews.value = safeNumber(payload?.pageViews);
    totalErrors.value =
      safeNumber(payload?.traffic?.byRoute?.content?.failed) +
      safeNumber(payload?.traffic?.byRoute?.stock?.failed);
    const incomingPeriodStats = payload?.periodStats ?? {};
    periodStats.value = {
      day: { requests: safeNumber(incomingPeriodStats?.day?.requests), pageViews: safeNumber(incomingPeriodStats?.day?.pageViews), errors: safeNumber(incomingPeriodStats?.day?.errors), uniqueVisitors: safeNumber(incomingPeriodStats?.day?.uniqueVisitors), peakRpm: safeNumber(incomingPeriodStats?.day?.peakRpm), avgPerDay: safeNumber(incomingPeriodStats?.day?.avgPerDay), days: safeNumber(incomingPeriodStats?.day?.days) || 1 },
      week: { requests: safeNumber(incomingPeriodStats?.week?.requests), pageViews: safeNumber(incomingPeriodStats?.week?.pageViews), errors: safeNumber(incomingPeriodStats?.week?.errors), uniqueVisitors: safeNumber(incomingPeriodStats?.week?.uniqueVisitors), peakRpm: safeNumber(incomingPeriodStats?.week?.peakRpm), avgPerDay: safeNumber(incomingPeriodStats?.week?.avgPerDay), days: safeNumber(incomingPeriodStats?.week?.days) || 7 },
      month: { requests: safeNumber(incomingPeriodStats?.month?.requests), pageViews: safeNumber(incomingPeriodStats?.month?.pageViews), errors: safeNumber(incomingPeriodStats?.month?.errors), uniqueVisitors: safeNumber(incomingPeriodStats?.month?.uniqueVisitors), peakRpm: safeNumber(incomingPeriodStats?.month?.peakRpm), avgPerDay: safeNumber(incomingPeriodStats?.month?.avgPerDay), days: safeNumber(incomingPeriodStats?.month?.days) || 30 },
      year: { requests: safeNumber(incomingPeriodStats?.year?.requests), pageViews: safeNumber(incomingPeriodStats?.year?.pageViews), errors: safeNumber(incomingPeriodStats?.year?.errors), uniqueVisitors: safeNumber(incomingPeriodStats?.year?.uniqueVisitors), peakRpm: safeNumber(incomingPeriodStats?.year?.peakRpm), avgPerDay: safeNumber(incomingPeriodStats?.year?.avgPerDay), days: safeNumber(incomingPeriodStats?.year?.days) || 365 },
    };
    const incomingBuckets = payload?.traffic?.buckets ?? {};
    buckets.value = {
      minute: typeof incomingBuckets.minute === "object" ? incomingBuckets.minute : {},
      day: typeof incomingBuckets.day === "object" ? incomingBuckets.day : {},
      visitorHours: typeof incomingBuckets.visitorHours === "object" ? incomingBuckets.visitorHours : {},
      visitorDays: typeof incomingBuckets.visitorDays === "object" ? incomingBuckets.visitorDays : {},
      errorMinutes: typeof incomingBuckets.errorMinutes === "object" ? incomingBuckets.errorMinutes : {},
      errorsByDay: typeof incomingBuckets.errorsByDay === "object" ? incomingBuckets.errorsByDay : {},
    };
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Okänt fel";
  } finally {
    loading.value = false;
  }
}

onMounted(async () => {
  await loadSummary();
});

watch(() => [props.isLoggedIn, props.currentUsername], async () => {
  if (isAdmin.value) await loadSummary();
});
</script>

<template>
  <section class="admin-page">
    <header class="admin-header">
      <p class="eyebrow">Admin</p>
      <h1>Statistik</h1>
      <p>Diagram för anrop, besökare och fel.</p>
    </header>

    <section v-if="!isAdmin" class="panel">
      <h2>Ej behörig</h2>
      <p>Den här vyn är endast tillgänglig för admin.</p>
    </section>

    <section v-else class="panel">
      <div class="toolbar-links">
        <router-link class="tab-link" to="/admin">Trafik & drift</router-link>
        <span class="tab-link active">Statistik</span>
        <router-link class="tab-link" to="/admin/hardening">Blockeringsskydd</router-link>
      </div>

      <div class="toolbar-links">
        <button class="tab-link" :class="{ active: selectedPeriod === 'day' }" type="button" @click="selectedPeriod = 'day'">Dag</button>
        <button class="tab-link" :class="{ active: selectedPeriod === 'week' }" type="button" @click="selectedPeriod = 'week'">Vecka</button>
        <button class="tab-link" :class="{ active: selectedPeriod === 'month' }" type="button" @click="selectedPeriod = 'month'">Månad</button>
        <button class="tab-link" :class="{ active: selectedPeriod === 'year' }" type="button" @click="selectedPeriod = 'year'">År</button>
      </div>

      <div class="stats-grid">
        <article class="stat-card"><h2>Besökare</h2><p class="stat-value">{{ totalUniqueVisitors }}</p><p class="small">Totalt</p></article>
        <article class="stat-card"><h2>Sidvisningar</h2><p class="stat-value">{{ totalPageViews }}</p><p class="small">Totalt</p></article>
        <article class="stat-card"><h2>Fel</h2><p class="stat-value">{{ totalErrors }}</p><p class="small">Totalt</p></article>
      </div>
      <p class="small period-note">Vald period ({{ selectedPeriod === "day" ? "dag" : selectedPeriod === "week" ? "vecka" : selectedPeriod === "month" ? "månad" : "år" }}): Besökare {{ selectedPeriodStats.uniqueVisitors }}, Sidvisningar {{ selectedPeriodStats.pageViews }}, Fel {{ selectedPeriodStats.errors }}.</p>

      <h2 class="section-title">Diagram (anrop)</h2>
      <div class="charts-grid">
        <article class="chart-card"><h3>Dag</h3><div class="bars"><div v-for="(v, i) in reqDay.values" :key="`rd-${i}`" class="bar-col"><div class="bar" :style="{ height: barHeightPercent(v, chartMax(reqDay.values)) }" /><span class="bar-label">{{ reqDay.labels[i] }}</span></div></div></article>
        <article class="chart-card"><h3>Vecka</h3><div class="bars"><div v-for="(v, i) in reqWeek.values" :key="`rw-${i}`" class="bar-col"><div class="bar" :style="{ height: barHeightPercent(v, chartMax(reqWeek.values)) }" /><span class="bar-label">{{ reqWeek.labels[i] }}</span></div></div></article>
        <article class="chart-card"><h3>Månad</h3><div class="bars"><div v-for="(v, i) in reqMonth.values" :key="`rm-${i}`" class="bar-col"><div class="bar" :style="{ height: barHeightPercent(v, chartMax(reqMonth.values)) }" /><span class="bar-label">{{ reqMonth.labels[i] }}</span></div></div></article>
        <article class="chart-card"><h3>År</h3><div class="bars"><div v-for="(v, i) in reqYear.values" :key="`ry-${i}`" class="bar-col"><div class="bar" :style="{ height: barHeightPercent(v, chartMax(reqYear.values)) }" /><span class="bar-label">{{ reqYear.labels[i] }}</span></div></div></article>
      </div>

      <h2 class="section-title">Diagram (besökare)</h2>
      <div class="charts-grid">
        <article class="chart-card"><h3>Dag</h3><div class="bars"><div v-for="(v, i) in visitorsDay.values" :key="`vd-${i}`" class="bar-col"><div class="bar" :style="{ height: barHeightPercent(v, chartMax(visitorsDay.values)) }" /><span class="bar-label">{{ visitorsDay.labels[i] }}</span></div></div></article>
        <article class="chart-card"><h3>Vecka</h3><div class="bars"><div v-for="(v, i) in visitorsWeek.values" :key="`vw-${i}`" class="bar-col"><div class="bar" :style="{ height: barHeightPercent(v, chartMax(visitorsWeek.values)) }" /><span class="bar-label">{{ visitorsWeek.labels[i] }}</span></div></div></article>
        <article class="chart-card"><h3>Månad</h3><div class="bars"><div v-for="(v, i) in visitorsMonth.values" :key="`vm-${i}`" class="bar-col"><div class="bar" :style="{ height: barHeightPercent(v, chartMax(visitorsMonth.values)) }" /><span class="bar-label">{{ visitorsMonth.labels[i] }}</span></div></div></article>
        <article class="chart-card"><h3>År</h3><div class="bars"><div v-for="(v, i) in visitorsYear.values" :key="`vy-${i}`" class="bar-col"><div class="bar" :style="{ height: barHeightPercent(v, chartMax(visitorsYear.values)) }" /><span class="bar-label">{{ visitorsYear.labels[i] }}</span></div></div></article>
      </div>

      <h2 class="section-title">Diagram (fel)</h2>
      <div class="charts-grid">
        <article class="chart-card"><h3>Dag</h3><div class="bars"><div v-for="(v, i) in errorsDay.values" :key="`ed-${i}`" class="bar-col"><div class="bar" :style="{ height: barHeightPercent(v, chartMax(errorsDay.values)) }" /><span class="bar-label">{{ errorsDay.labels[i] }}</span></div></div></article>
        <article class="chart-card"><h3>Vecka</h3><div class="bars"><div v-for="(v, i) in errorsWeek.values" :key="`ew-${i}`" class="bar-col"><div class="bar" :style="{ height: barHeightPercent(v, chartMax(errorsWeek.values)) }" /><span class="bar-label">{{ errorsWeek.labels[i] }}</span></div></div></article>
        <article class="chart-card"><h3>Månad</h3><div class="bars"><div v-for="(v, i) in errorsMonth.values" :key="`em-${i}`" class="bar-col"><div class="bar" :style="{ height: barHeightPercent(v, chartMax(errorsMonth.values)) }" /><span class="bar-label">{{ errorsMonth.labels[i] }}</span></div></div></article>
        <article class="chart-card"><h3>År</h3><div class="bars"><div v-for="(v, i) in errorsYear.values" :key="`ey-${i}`" class="bar-col"><div class="bar" :style="{ height: barHeightPercent(v, chartMax(errorsYear.values)) }" /><span class="bar-label">{{ errorsYear.labels[i] }}</span></div></div></article>
      </div>

      <div class="toolbar">
        <button type="button" :disabled="loading" @click="loadSummary">{{ loading ? "Laddar..." : "Uppdatera" }}</button>
      </div>
      <p v-if="error" class="error">{{ error }}</p>
    </section>
  </section>
</template>

<style scoped>
.admin-page { max-width: 1100px; margin: 0 auto; }
.admin-header { margin-bottom: 1rem; }
.eyebrow { margin: 0; color: var(--primary); font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; }
h1 { margin: 0.15rem 0 0.35rem; }
.panel { border-radius: var(--radius); background: var(--surface); border: 1px solid var(--line); box-shadow: var(--shadow); padding: 1.2rem; }
.toolbar-links { display: flex; gap: 0.6rem; margin-bottom: 0.8rem; flex-wrap: wrap; }
.tab-link { border: 1px solid var(--line); border-radius: 10px; padding: 0.45rem 0.7rem; text-decoration: none; color: var(--text); background: var(--surface-strong); font-weight: 700; }
.tab-link.active { background: linear-gradient(135deg, var(--primary) 0%, var(--primary-strong) 100%); color: #fff; border-color: transparent; }
.stats-grid { display: grid; grid-template-columns: repeat(3, minmax(170px, 1fr)); gap: 0.9rem; }
.stat-card { border: 1px solid var(--line); border-radius: 12px; padding: 0.9rem; background: var(--surface-strong); }
.stat-card h2 { margin: 0; font-size: 0.95rem; color: var(--muted); font-weight: 700; }
.stat-value { margin: 0.35rem 0 0; font-size: 2rem; font-weight: 800; color: var(--text); }
.section-title { margin: 1rem 0 0.6rem; font-size: 1.05rem; }
.charts-grid { display: grid; grid-template-columns: repeat(2, minmax(280px, 1fr)); gap: 0.9rem; margin-bottom: 1rem; }
.chart-card { border: 1px solid var(--line); border-radius: 12px; padding: 0.8rem; background: var(--surface-strong); }
.chart-card h3 { margin: 0 0 0.6rem; font-size: 0.95rem; }
.bars { height: 170px; border: 1px solid var(--line); border-radius: 10px; padding: 0.5rem; display: flex; align-items: flex-end; gap: 0.28rem; overflow-x: auto; background: #fff; }
.bar-col { min-width: 24px; height: 100%; flex: 1 0 24px; display: flex; flex-direction: column; align-items: center; justify-content: flex-end; gap: 0.3rem; }
.bar { width: 100%; min-height: 0; border-radius: 6px 6px 0 0; background: linear-gradient(180deg, var(--primary) 0%, var(--primary-strong) 100%); }
.bar-label { font-size: 0.66rem; color: var(--muted); white-space: nowrap; }
.toolbar { margin-top: 0.8rem; }
.small { margin: 0.25rem 0 0; color: var(--muted); font-size: 0.8rem; }
.period-note { margin: 0.5rem 0 1rem; }
button { border: none; border-radius: 10px; padding: 0.65rem 1rem; background: linear-gradient(135deg, var(--primary) 0%, var(--primary-strong) 100%); color: #fff; font-weight: 600; cursor: pointer; }
.error { margin-top: 0.8rem; color: var(--danger); }
@media (max-width: 860px) { .stats-grid { grid-template-columns: 1fr 1fr; } .charts-grid { grid-template-columns: 1fr; } }
</style>
