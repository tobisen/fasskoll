<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";

const props = withDefaults(
  defineProps<{ isLoggedIn?: boolean; currentUsername?: string }>(),
  {
    isLoggedIn: false,
    currentUsername: "",
  },
);

type RouteStats = {
  requests: number;
  success: number;
  failed: number;
  rateLimited: number;
  killSwitch: number;
  circuitOpen: number;
  upstreamCalls: number;
  cacheHits: number;
};

type TrafficSummary = {
  totalRequests: number;
  byRoute: {
    content: RouteStats;
    stock: RouteStats;
  };
  recentErrors: Array<{
    timestamp: string;
    route: string;
    status: number | null;
    category: string;
    message: string;
  }>;
};

type PeakSummary = {
  peakRequestsPerMinuteLastHour: number;
  peakRequestsPerMinuteLast24h: number;
  requestsLastHour: number;
  requestsLast24h: number;
  topPeaks: Array<{ minute: string; count: number }>;
};

type FassServiceSummary = {
  requestTimeoutMs: number;
  maxTotalRequestTimeMs: number;
  retryMaxAttempts: number;
  circuitBreakerThreshold: number;
  circuitBreakerCooldownMs: number;
  circuitOpen: boolean;
  circuitOpenUntil: string | null;
  consecutiveFailures: number;
  circuitOpenedCount: number;
  lastCircuitOpenedAt: string | null;
};

const loading = ref(false);
const error = ref("");
const uniqueVisitors = ref<number>(0);
const pageViews = ref<number>(0);
const updatedAt = ref<string | null>(null);
const traffic = ref<TrafficSummary>({
  totalRequests: 0,
  byRoute: {
    content: {
      requests: 0,
      success: 0,
      failed: 0,
      rateLimited: 0,
      killSwitch: 0,
      circuitOpen: 0,
      upstreamCalls: 0,
      cacheHits: 0,
    },
    stock: {
      requests: 0,
      success: 0,
      failed: 0,
      rateLimited: 0,
      killSwitch: 0,
      circuitOpen: 0,
      upstreamCalls: 0,
      cacheHits: 0,
    },
  },
  recentErrors: [],
});
const peaks = ref<PeakSummary>({
  peakRequestsPerMinuteLastHour: 0,
  peakRequestsPerMinuteLast24h: 0,
  requestsLastHour: 0,
  requestsLast24h: 0,
  topPeaks: [],
});
const fassService = ref<FassServiceSummary>({
  requestTimeoutMs: 0,
  maxTotalRequestTimeMs: 0,
  retryMaxAttempts: 0,
  circuitBreakerThreshold: 0,
  circuitBreakerCooldownMs: 0,
  circuitOpen: false,
  circuitOpenUntil: null,
  consecutiveFailures: 0,
  circuitOpenedCount: 0,
  lastCircuitOpenedAt: null,
});

const isAdmin = computed(
  () => props.isLoggedIn && props.currentUsername === "admin",
);

const routeRows = computed(() => [
  { route: "content", ...traffic.value.byRoute.content },
  { route: "stock", ...traffic.value.byRoute.stock },
]);

const errorCount = computed(() => traffic.value.recentErrors.length);

function formatDate(value: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("sv-SE", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function safeNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

async function loadSummary() {
  if (!isAdmin.value) return;

  loading.value = true;
  error.value = "";
  try {
    const response = await fetch("/api/metrics/summary", {
      method: "GET",
      credentials: "include",
      cache: "no-store",
    });

    if (!response.ok) {
      throw new Error(response.status === 403 ? "Saknar behörighet." : "Kunde inte läsa statistik.");
    }

    const payload = await response.json();
    uniqueVisitors.value = safeNumber(payload?.uniqueVisitors);
    pageViews.value = safeNumber(payload?.pageViews);
    updatedAt.value = typeof payload?.updatedAt === "string" ? payload.updatedAt : null;

    const incomingTraffic = payload?.traffic ?? {};
    const byRoute = incomingTraffic?.byRoute ?? {};
    traffic.value = {
      totalRequests: safeNumber(incomingTraffic?.totalRequests),
      byRoute: {
        content: {
          requests: safeNumber(byRoute?.content?.requests),
          success: safeNumber(byRoute?.content?.success),
          failed: safeNumber(byRoute?.content?.failed),
          rateLimited: safeNumber(byRoute?.content?.rateLimited),
          killSwitch: safeNumber(byRoute?.content?.killSwitch),
          circuitOpen: safeNumber(byRoute?.content?.circuitOpen),
          upstreamCalls: safeNumber(byRoute?.content?.upstreamCalls),
          cacheHits: safeNumber(byRoute?.content?.cacheHits),
        },
        stock: {
          requests: safeNumber(byRoute?.stock?.requests),
          success: safeNumber(byRoute?.stock?.success),
          failed: safeNumber(byRoute?.stock?.failed),
          rateLimited: safeNumber(byRoute?.stock?.rateLimited),
          killSwitch: safeNumber(byRoute?.stock?.killSwitch),
          circuitOpen: safeNumber(byRoute?.stock?.circuitOpen),
          upstreamCalls: safeNumber(byRoute?.stock?.upstreamCalls),
          cacheHits: safeNumber(byRoute?.stock?.cacheHits),
        },
      },
      recentErrors: Array.isArray(incomingTraffic?.recentErrors)
        ? incomingTraffic.recentErrors.slice(0, 20)
        : [],
    };

    const incomingPeaks = payload?.peaks ?? {};
    peaks.value = {
      peakRequestsPerMinuteLastHour: safeNumber(incomingPeaks?.peakRequestsPerMinuteLastHour),
      peakRequestsPerMinuteLast24h: safeNumber(incomingPeaks?.peakRequestsPerMinuteLast24h),
      requestsLastHour: safeNumber(incomingPeaks?.requestsLastHour),
      requestsLast24h: safeNumber(incomingPeaks?.requestsLast24h),
      topPeaks: Array.isArray(incomingPeaks?.topPeaks) ? incomingPeaks.topPeaks.slice(0, 5) : [],
    };

    const incomingFassService = payload?.fassService ?? {};
    fassService.value = {
      requestTimeoutMs: safeNumber(incomingFassService?.requestTimeoutMs),
      maxTotalRequestTimeMs: safeNumber(incomingFassService?.maxTotalRequestTimeMs),
      retryMaxAttempts: safeNumber(incomingFassService?.retryMaxAttempts),
      circuitBreakerThreshold: safeNumber(incomingFassService?.circuitBreakerThreshold),
      circuitBreakerCooldownMs: safeNumber(incomingFassService?.circuitBreakerCooldownMs),
      circuitOpen: Boolean(incomingFassService?.circuitOpen),
      circuitOpenUntil:
        typeof incomingFassService?.circuitOpenUntil === "string"
          ? incomingFassService.circuitOpenUntil
          : null,
      consecutiveFailures: safeNumber(incomingFassService?.consecutiveFailures),
      circuitOpenedCount: safeNumber(incomingFassService?.circuitOpenedCount),
      lastCircuitOpenedAt:
        typeof incomingFassService?.lastCircuitOpenedAt === "string"
          ? incomingFassService.lastCircuitOpenedAt
          : null,
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

watch(
  () => [props.isLoggedIn, props.currentUsername],
  async () => {
    if (isAdmin.value) {
      await loadSummary();
    }
  },
);
</script>

<template>
  <section class="admin-page">
    <header class="admin-header">
      <p class="eyebrow">Admin</p>
      <h1>Trafik och drift</h1>
      <p>Översikt över besök, API-trafik, fel och toppar.</p>
    </header>

    <section v-if="!isAdmin" class="panel">
      <h2>Ej behörig</h2>
      <p>Den här vyn är endast tillgänglig för admin.</p>
    </section>

    <section v-else class="panel">
      <div class="toolbar-links">
        <span class="tab-link active">Trafik & drift</span>
        <router-link class="tab-link" to="/admin/hardening">Blockeringsskydd</router-link>
      </div>

      <div class="stats-grid">
        <article class="stat-card">
          <h2>Unika besökare</h2>
          <p class="stat-value">{{ uniqueVisitors }}</p>
        </article>
        <article class="stat-card">
          <h2>Sidvisningar</h2>
          <p class="stat-value">{{ pageViews }}</p>
        </article>
        <article class="stat-card">
          <h2>API-anrop totalt</h2>
          <p class="stat-value">{{ traffic.totalRequests }}</p>
        </article>
        <article class="stat-card">
          <h2>Fel (senaste logg)</h2>
          <p class="stat-value">{{ errorCount }}</p>
        </article>
        <article class="stat-card">
          <h2>Topp RPM (1h)</h2>
          <p class="stat-value">{{ peaks.peakRequestsPerMinuteLastHour }}</p>
        </article>
        <article class="stat-card">
          <h2>Topp RPM (24h)</h2>
          <p class="stat-value">{{ peaks.peakRequestsPerMinuteLast24h }}</p>
        </article>
        <article class="stat-card">
          <h2>Circuit breaker</h2>
          <p class="stat-value">{{ fassService.circuitOpen ? "Öppen" : "Stängd" }}</p>
        </article>
      </div>

      <p class="meta">Senast uppdaterad: {{ formatDate(updatedAt) }}</p>

      <div class="toolbar">
        <button type="button" :disabled="loading" @click="loadSummary">
          {{ loading ? "Laddar..." : "Uppdatera" }}
        </button>
      </div>

      <h2 class="section-title">Trafik per endpoint</h2>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Endpoint</th>
              <th>Anrop</th>
              <th>OK</th>
              <th>Fel</th>
              <th>Rate limit</th>
              <th>Kill switch</th>
              <th>Circuit open</th>
              <th>Mot Fass</th>
              <th>Från cache</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in routeRows" :key="row.route">
              <td>/api/{{ row.route }}</td>
              <td>{{ row.requests }}</td>
              <td>{{ row.success }}</td>
              <td>{{ row.failed }}</td>
              <td>{{ row.rateLimited }}</td>
              <td>{{ row.killSwitch }}</td>
              <td>{{ row.circuitOpen }}</td>
              <td>{{ row.upstreamCalls }}</td>
              <td>{{ row.cacheHits }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <h2 class="section-title">Fass service-läge</h2>
      <div class="table-wrap">
        <table>
          <tbody>
            <tr>
              <th>Timeout per försök</th>
              <td>{{ fassService.requestTimeoutMs }} ms</td>
            </tr>
            <tr>
              <th>Max total requesttid</th>
              <td>{{ fassService.maxTotalRequestTimeMs }} ms</td>
            </tr>
            <tr>
              <th>Max retries</th>
              <td>{{ fassService.retryMaxAttempts }}</td>
            </tr>
            <tr>
              <th>Circuit tröskel</th>
              <td>{{ fassService.circuitBreakerThreshold }}</td>
            </tr>
            <tr>
              <th>Circuit cooldown</th>
              <td>{{ fassService.circuitBreakerCooldownMs }} ms</td>
            </tr>
            <tr>
              <th>Consecutive failures</th>
              <td>{{ fassService.consecutiveFailures }}</td>
            </tr>
            <tr>
              <th>Antal öppningar</th>
              <td>{{ fassService.circuitOpenedCount }}</td>
            </tr>
            <tr>
              <th>Senast öppnad</th>
              <td>{{ formatDate(fassService.lastCircuitOpenedAt) }}</td>
            </tr>
            <tr>
              <th>Öppen till</th>
              <td>{{ formatDate(fassService.circuitOpenUntil) }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="two-col">
        <section>
          <h2 class="section-title">Toppminuter</h2>
          <ul class="list">
            <li v-for="item in peaks.topPeaks" :key="`${item.minute}-${item.count}`">
              <span>{{ item.minute }}</span>
              <strong>{{ item.count }} req/min</strong>
            </li>
            <li v-if="peaks.topPeaks.length === 0">Inga toppdata ännu.</li>
          </ul>
        </section>

        <section>
          <h2 class="section-title">Senaste fel</h2>
          <ul class="list">
            <li v-for="item in traffic.recentErrors" :key="`${item.timestamp}-${item.route}-${item.message}`">
              <div>
                <strong>{{ item.route }}</strong>
                <span class="small"> {{ formatDate(item.timestamp) }}</span>
              </div>
              <div class="small">
                {{ item.category }}<span v-if="item.status"> ({{ item.status }})</span>
              </div>
              <div>{{ item.message }}</div>
            </li>
            <li v-if="traffic.recentErrors.length === 0">Inga fel loggade.</li>
          </ul>
        </section>
      </div>

      <p v-if="error" class="error">{{ error }}</p>
    </section>
  </section>
</template>

<style scoped>
.admin-page {
  max-width: 1100px;
  margin: 0 auto;
}

.admin-header {
  margin-bottom: 1rem;
}

.eyebrow {
  margin: 0;
  color: var(--primary);
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

h1 {
  margin: 0.15rem 0 0.35rem;
}

.panel {
  border-radius: var(--radius);
  background: var(--surface);
  border: 1px solid var(--line);
  box-shadow: var(--shadow);
  padding: 1.2rem;
}

.stats-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(170px, 1fr));
  gap: 0.9rem;
}

.stat-card {
  border: 1px solid var(--line);
  border-radius: 12px;
  padding: 0.9rem;
  background: var(--surface-strong);
}

.stat-card h2 {
  margin: 0;
  font-size: 0.95rem;
  color: var(--muted);
  font-weight: 700;
}

.stat-value {
  margin: 0.35rem 0 0;
  font-size: 2rem;
  font-weight: 800;
  color: var(--text);
}

.meta {
  margin: 1rem 0 0.8rem;
  color: var(--muted);
}

.toolbar-links {
  display: flex;
  gap: 0.6rem;
  margin-bottom: 0.8rem;
}

.tab-link {
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 0.45rem 0.7rem;
  text-decoration: none;
  color: var(--text);
  background: var(--surface-strong);
  font-weight: 700;
}

.tab-link.active {
  background: linear-gradient(135deg, var(--primary) 0%, var(--primary-strong) 100%);
  color: #fff;
  border-color: transparent;
}

.toolbar {
  margin-bottom: 1rem;
}

button {
  border: none;
  border-radius: 10px;
  padding: 0.65rem 1rem;
  background: linear-gradient(135deg, var(--primary) 0%, var(--primary-strong) 100%);
  color: #fff;
  font-weight: 600;
  cursor: pointer;
}

.section-title {
  margin: 1rem 0 0.6rem;
  font-size: 1.05rem;
}

.table-wrap {
  overflow-x: auto;
  border: 1px solid var(--line);
  border-radius: 12px;
}

table {
  width: 100%;
  border-collapse: collapse;
}

th,
td {
  text-align: left;
  padding: 0.6rem 0.7rem;
  border-bottom: 1px solid var(--line);
}

th {
  background: var(--surface-strong);
}

.two-col {
  margin-top: 1rem;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.9rem;
}

.list {
  margin: 0;
  padding: 0;
  list-style: none;
  border: 1px solid var(--line);
  border-radius: 12px;
  background: var(--surface-strong);
}

.list li {
  padding: 0.7rem;
  border-bottom: 1px solid var(--line);
}

.list li:last-child {
  border-bottom: none;
}

.small {
  color: var(--muted);
  font-size: 0.85rem;
}

.error {
  margin-top: 0.8rem;
  color: var(--danger);
}

@media (max-width: 860px) {
  .stats-grid {
    grid-template-columns: 1fr 1fr;
  }

  .two-col {
    grid-template-columns: 1fr;
  }
}
</style>
