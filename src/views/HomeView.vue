<script setup lang="ts">
const props = withDefaults(
  defineProps<{ isLoggedIn?: boolean; currentUsername?: string }>(),
  {
    isLoggedIn: false,
    currentUsername: "",
  },
);

const isAdmin = props.isLoggedIn && props.currentUsername === "admin";
</script>

<template>
  <section class="home">
    <header class="hero">
      <p class="eyebrow">Fasskoll</p>
      <h1>Snabb koll av lagerstatus på svenska apotek</h1>
      <p class="lead">
        Välj läkemedel, ange postnummer och få en tydlig överblick över tillgänglighet
        per apotek och styrka.
      </p>
      <p class="disclaimer">
        Viktigt: Fasskoll är en intern hobbytjänst och <strong>inte en officiell tjänst från Fass</strong>.
        Kontrollera alltid information i officiella källor vid behov.
      </p>
    </header>

    <section class="panel">
      <h2>Snabbval</h2>
      <div class="quick-grid">
        <router-link class="quick-card" :to="{ path: '/search', query: { medicine: 'Estradot', zipCode: '75318', autostart: '1' } }">
          <strong>Estradot</strong>
          <span>Depotplåster</span>
        </router-link>
        <router-link class="quick-card" :to="{ path: '/search', query: { medicine: 'Lenzetto', zipCode: '75318', autostart: '1' } }">
          <strong>Lenzetto</strong>
          <span>Transdermal spray</span>
        </router-link>
        <router-link class="quick-card" :to="{ path: '/search', query: { medicine: 'Divigel', zipCode: '75318', autostart: '1' } }">
          <strong>Divigel</strong>
          <span>Gel</span>
        </router-link>
        <router-link class="quick-card" :to="{ path: '/search', query: { medicine: 'Estrogel', zipCode: '75318', autostart: '1' } }">
          <strong>Estrogel</strong>
          <span>Gel</span>
        </router-link>
      </div>
    </section>

    <section v-if="isAdmin" class="panel">
      <h2>Driftöversikt</h2>
      <div class="info-grid">
        <article>
          <h3>Stabilitet</h3>
          <p>Timeout, begränsade retries och tydlig felhantering mot Fass.</p>
        </article>
        <article>
          <h3>Skydd</h3>
          <p>Rate limiting för oinloggade och kill switch för snabb avstängning.</p>
        </article>
        <article>
          <h3>Prestanda</h3>
          <p>Cache per <code>packageId + zipCode</code> med lång TTL för lägre belastning.</p>
        </article>
      </div>
    </section>
  </section>
</template>

<style scoped>
.home {
  max-width: 1100px;
  margin: 0 auto;
  display: grid;
  gap: 1rem;
}

.hero {
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background:
    linear-gradient(135deg, rgba(0, 90, 156, 0.1), rgba(15, 118, 110, 0.08)),
    var(--surface);
  box-shadow: var(--shadow);
  padding: 1.4rem;
}

.eyebrow {
  margin: 0;
  color: var(--primary);
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

h1 {
  margin: 0.35rem 0 0.5rem;
  font-size: clamp(1.6rem, 4vw, 2.2rem);
}

.lead {
  margin: 0;
  color: var(--muted);
  max-width: 58ch;
}

.disclaimer {
  margin-top: 0.75rem;
  border: 1px solid color-mix(in srgb, var(--warn) 45%, var(--line));
  background: color-mix(in srgb, #fff 82%, #f59e0b 18%);
  color: #4a2b00;
  border-radius: 10px;
  padding: 0.65rem 0.75rem;
  max-width: 72ch;
}

.panel {
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--surface);
  box-shadow: var(--shadow);
  padding: 1rem;
}

h2 {
  margin: 0 0 0.7rem;
}

.quick-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(180px, 1fr));
  gap: 0.7rem;
}

.quick-card {
  border: 1px solid var(--line);
  border-radius: 12px;
  padding: 0.8rem;
  text-decoration: none;
  color: var(--text);
  background: var(--surface-strong);
  display: grid;
  gap: 0.2rem;
}

.quick-card span {
  color: var(--muted);
}

.info-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(160px, 1fr));
  gap: 0.7rem;
}

.info-grid article {
  border: 1px solid var(--line);
  border-radius: 12px;
  padding: 0.75rem;
  background: var(--surface-strong);
}

h3 {
  margin: 0 0 0.35rem;
}

p {
  margin: 0;
}

code {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
}

@media (max-width: 860px) {
  .quick-grid,
  .info-grid {
    grid-template-columns: 1fr;
  }
}
</style>
