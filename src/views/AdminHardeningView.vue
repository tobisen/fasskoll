<script setup lang="ts">
import { computed } from "vue";

const props = withDefaults(
  defineProps<{ isLoggedIn?: boolean; currentUsername?: string }>(),
  {
    isLoggedIn: false,
    currentUsername: "",
  },
);

const isAdmin = computed(
  () => props.isLoggedIn && props.currentUsername === "admin",
);

type Status = "implemented" | "partial";

type Item = {
  title: string;
  status: Status;
  details: string;
};

const hardeningItems: Item[] = [
  {
    title: "Lägg sökning på valfria mediciner bakom inloggning",
    status: "implemented",
    details: "Publika snabbval är låsta till utvalda läkemedel, övrig fri sökning kräver inloggning.",
  },
  {
    title: "Skapa adminvy (inloggning) för att visa antal unika besökare",
    status: "implemented",
    details: "Adminpanelen visar unika besökare och sidvisningar.",
  },
  {
    title: "Aktivera analytics i Vercel",
    status: "implemented",
    details: "Vercel Analytics är inkopplat i appen.",
  },
  {
    title: "Lägg till tre vanligaste mediciner som fasta menyalternativ",
    status: "implemented",
    details: "Fasta menyalternativ finns (nu fyra, inkl. Estrogel) för att minska fri sökbredd.",
  },
  {
    title: "Lägg all Fass-kommunikation i ett enda fassClient/service-lager",
    status: "implemented",
    details: "Central service på backend + isolerat klientlager på frontend.",
  },
  {
    title: "Kör via egen backend/proxy (inte direkt från frontend)",
    status: "implemented",
    details: "All Fass-trafik går via /api/content och /api/stock.",
  },
  {
    title: "Inför hård rate limiting per användare/IP",
    status: "implemented",
    details: "Hård begränsning för oinloggade per IP på content/stock-routes.",
  },
  {
    title: "Cachea svar per packageId + zipCode med TTL",
    status: "implemented",
    details: "Stock-cache per zip+package med lång TTL och stale fallback.",
  },
  {
    title: "Kör endast anrop på användarklick (ingen polling)",
    status: "implemented",
    details: "Inga loopande bakgrundsanrop. Endast klick/explicit navigering triggar.",
  },
  {
    title: "Timeout + begränsade retries + tydlig felhantering",
    status: "implemented",
    details: "Timeout, retry/backoff/jitter och uppströmsfel är centraliserat hanterat.",
  },
  {
    title: "Bygg kill switch för att snabbt stänga av tjänsten",
    status: "implemented",
    details: "Env-styrd kill switch returnerar 503 direkt på Fass-routes.",
  },
  {
    title: "Logga trafik, fel och toppar",
    status: "implemented",
    details: "Metrics samlar trafik, felhistorik och peak-minute i admin.",
  },
  {
    title: "Begränsa antal sökningar per minut/session",
    status: "partial",
    details: "Per IP finns. Per session kan läggas till som nästa steg.",
  },
  {
    title: "Validera all input strikt (zip, packageId)",
    status: "implemented",
    details: "Strikt backendvalidering för postnummer, packageId och variantmängd.",
  },
  {
    title: "Visa fallback när Fass inte svarar",
    status: "implemented",
    details: "UI visar tydlig fallback/degraded-status och stale cache vid behov.",
  },
  {
    title: "Isolera Fass-typer/mapping för enkel ändring",
    status: "implemented",
    details: "Typer och mappers ligger i separata filer för enklare underhåll.",
  },
  {
    title: "Lägg disclaimer (ej officiell tjänst)",
    status: "implemented",
    details: "Tydlig disclaimer visas på startsidan.",
  },
  {
    title: "Minimera datalagring",
    status: "implemented",
    details: "Besöksdata är aggregerad/hashtad och vi sparar begränsad recent error-historik.",
  },
  {
    title: "Designa för att API:t kan ändras eller blockeras",
    status: "implemented",
    details: "Circuit breaker, stale cache, proxy-lager och isolerade mappers minskar risk.",
  },
];
</script>

<template>
  <section class="hardening-page">
    <header class="hardening-header">
      <p class="eyebrow">Admin</p>
      <h1>Blockeringsskydd och robusthet</h1>
      <p>Checklista över genomförda skyddsåtgärder i Fasskoll.</p>
    </header>

    <section v-if="!isAdmin" class="panel">
      <h2>Ej behörig</h2>
      <p>Den här vyn är endast tillgänglig för admin.</p>
    </section>

    <section v-else class="panel">
      <div class="toolbar">
        <router-link class="tab-link" to="/admin">Trafik & drift</router-link>
        <span class="tab-link active">Blockeringsskydd</span>
      </div>

      <ul class="checklist">
        <li v-for="item in hardeningItems" :key="item.title" class="check-item">
          <div class="row">
            <strong>{{ item.title }}</strong>
            <span :class="['badge', item.status]">
              {{ item.status === "implemented" ? "Implementerat" : "Delvis" }}
            </span>
          </div>
          <p>{{ item.details }}</p>
        </li>
      </ul>
    </section>
  </section>
</template>

<style scoped>
.hardening-page {
  max-width: 1100px;
  margin: 0 auto;
}

.hardening-header {
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
  padding: 1.1rem;
}

.toolbar {
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

.checklist {
  margin: 0;
  padding: 0;
  list-style: none;
  display: grid;
  gap: 0.6rem;
}

.check-item {
  border: 1px solid var(--line);
  border-radius: 12px;
  background: var(--surface-strong);
  padding: 0.75rem 0.8rem;
}

.row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 0.8rem;
}

.check-item p {
  margin: 0.35rem 0 0;
  color: var(--muted);
}

.badge {
  font-size: 0.8rem;
  border-radius: 999px;
  padding: 0.15rem 0.55rem;
  font-weight: 700;
  white-space: nowrap;
}

.badge.implemented {
  color: #065f46;
  background: #d1fae5;
}

.badge.partial {
  color: #7c2d12;
  background: #ffedd5;
}
</style>

