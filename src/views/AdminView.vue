<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";

const props = withDefaults(
  defineProps<{ isLoggedIn?: boolean; currentUsername?: string }>(),
  {
    isLoggedIn: false,
    currentUsername: "",
  },
);

const loading = ref(false);
const error = ref("");
const uniqueVisitors = ref<number | null>(null);
const pageViews = ref<number | null>(null);
const updatedAt = ref<string | null>(null);

const isAdmin = computed(
  () => props.isLoggedIn && props.currentUsername === "admin",
);

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
    uniqueVisitors.value = Number(payload?.uniqueVisitors ?? 0);
    pageViews.value = Number(payload?.pageViews ?? 0);
    updatedAt.value = typeof payload?.updatedAt === "string" ? payload.updatedAt : null;
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
      <h1>Besöksstatistik</h1>
      <p>Intern mätning för Fasskoll.</p>
    </header>

    <section v-if="!isAdmin" class="panel">
      <h2>Ej behörig</h2>
      <p>Den här vyn är endast tillgänglig för admin.</p>
    </section>

    <section v-else class="panel">
      <div class="stats-grid">
        <article class="stat-card">
          <h2>Unika besökare</h2>
          <p class="stat-value">{{ uniqueVisitors ?? "-" }}</p>
        </article>

        <article class="stat-card">
          <h2>Sidvisningar</h2>
          <p class="stat-value">{{ pageViews ?? "-" }}</p>
        </article>
      </div>

      <p class="meta">Senast uppdaterad: {{ formatDate(updatedAt) }}</p>

      <button type="button" :disabled="loading" @click="loadSummary">
        {{ loading ? "Laddar..." : "Uppdatera" }}
      </button>

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
  grid-template-columns: repeat(2, minmax(170px, 1fr));
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

button {
  border: none;
  border-radius: 10px;
  padding: 0.65rem 1rem;
  background: linear-gradient(135deg, var(--primary) 0%, var(--primary-strong) 100%);
  color: #fff;
  font-weight: 600;
  cursor: pointer;
}

.error {
  margin-top: 0.8rem;
  color: var(--danger);
}
</style>
