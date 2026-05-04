<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { Analytics } from "@vercel/analytics/vue";
import DonationLink from "./components/DonationLink.vue";

const username = ref("");
const password = ref("");
const isLoggedIn = ref(false);
const currentUsername = ref("");
const authLoading = ref(true);
const showLoginForm = ref(false);
const error = ref("");
const router = useRouter();
const route = useRoute();
const kofiUrl = computed(() => (import.meta.env.VITE_KOFI_URL ?? "").trim());

const VISITOR_ID_STORAGE_KEY = "fasskoll_visitor_id";

function getVisitorId() {
  const existing = localStorage.getItem(VISITOR_ID_STORAGE_KEY);
  if (existing && existing.trim()) {
    return existing;
  }

  const generated =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  localStorage.setItem(VISITOR_ID_STORAGE_KEY, generated);
  return generated;
}

async function trackPageView(pathname: string) {
  try {
    await fetch("/api/metrics/track", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        visitorId: getVisitorId(),
        path: pathname,
      }),
      keepalive: true,
    });
  } catch {
    // no-op
  }
}

async function checkSession() {
  try {
    const response = await fetch("/api/auth/session", {
      method: "GET",
      credentials: "include",
      cache: "no-store",
    });

    if (!response.ok) {
      isLoggedIn.value = false;
      return;
    }

    const payload = await response.json();
    isLoggedIn.value = Boolean(payload?.authenticated);
    currentUsername.value =
      typeof payload?.username === "string" ? payload.username : "";
  } catch {
    isLoggedIn.value = false;
    currentUsername.value = "";
  }
}

async function handleLogin() {
  error.value = "";

  try {
    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        username: username.value,
        password: password.value,
      }),
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload?.ok) {
      error.value = "Fel användarnamn eller lösenord.";
      return;
    }

    isLoggedIn.value = true;
    currentUsername.value =
      typeof payload?.username === "string" ? payload.username : "";
    showLoginForm.value = false;
    password.value = "";
    router.push({
      path: "/search",
      query: {
        medicine: "Estradot",
        zipCode: "75318",
      },
    });
  } catch {
    error.value = "Kunde inte logga in just nu. Försök igen.";
  }
}

function resetLoginPanel() {
  username.value = "";
  password.value = "";
  error.value = "";
  showLoginForm.value = false;
}

async function handleLogout() {
  try {
    await fetch("/api/auth/logout", {
      method: "POST",
      credentials: "include",
    });
  } catch {
    // no-op
  }

  isLoggedIn.value = false;
  currentUsername.value = "";
  username.value = "";
  password.value = "";
  error.value = "";
  showLoginForm.value = false;
  window.location.href = "/";
}

function handleLoginLinkClick() {
  showLoginForm.value = true;
  error.value = "";
}

onMounted(async () => {
  await checkSession();
  await trackPageView(route.fullPath);
  authLoading.value = false;
});

watch(
  () => route.fullPath,
  async (newPath) => {
    await trackPageView(newPath);
  },
);
</script>

<template>
  <div class="site">
    <header class="site-header">
      <div class="header-left">
        <router-link class="brand brand-link" to="/" @click="resetLoginPanel">Fasskoll</router-link>
      </div>

      <nav class="header-center">
        <router-link
          :to="{
            path: '/search',
            query: {
              medicine: 'Estradot',
              zipCode: '75318',
              autostart: '1',
            },
          }"
        >
          Estradot
        </router-link>
        <router-link
          :to="{
            path: '/search',
            query: {
              medicine: 'Lenzetto',
              zipCode: '75318',
              autostart: '1',
            },
          }"
        >
          Lenzetto
        </router-link>
        <router-link
          :to="{
            path: '/search',
            query: {
              medicine: 'Divigel',
              zipCode: '75318',
              autostart: '1',
            },
          }"
        >
          Divigel
        </router-link>
        <router-link
          :to="{
            path: '/search',
            query: {
              medicine: 'Estrogel',
              zipCode: '75318',
              autostart: '1',
            },
          }"
        >
          Estrogel
        </router-link>
        <router-link
          :to="{
            path: '/search',
            query: {
              medicine: 'Utrogestan',
              zipCode: '75318',
              autostart: '1',
            },
          }"
        >
          Utrogestan
        </router-link>
        <router-link v-if="currentUsername === 'admin'" to="/admin">Admin</router-link>
        <router-link v-if="currentUsername === 'admin'" to="/admin/statistik">Statistik</router-link>
        <router-link v-if="currentUsername === 'admin'" to="/admin/hardening">Skydd</router-link>
      </nav>

      <div class="header-right">
        <a
          v-if="kofiUrl"
          :href="kofiUrl"
          target="_blank"
          rel="noopener noreferrer"
        >
          Stötta
        </a>
        <a v-if="!isLoggedIn && !authLoading" href="#" @click.prevent="handleLoginLinkClick">Logga in</a>
        <a v-if="isLoggedIn" href="#" @click.prevent="handleLogout">Logga ut</a>
      </div>
    </header>

    <main class="site-main">
      <section v-if="authLoading" class="panel">
        <h1>Kontrollerar session...</h1>
      </section>

      <section v-else-if="!isLoggedIn && showLoginForm" class="panel">
        <h1>Logga in</h1>
        <form class="login-form" @submit.prevent="handleLogin">
          <label for="username">Användarnamn</label>
          <input id="username" v-model="username" type="text" />

          <label for="password">Lösenord</label>
          <input id="password" v-model="password" type="password" />

          <button type="submit">Logga in</button>
          <p v-if="error" class="error">{{ error }}</p>
        </form>
      </section>

      <router-view v-slot="{ Component }">
        <component :is="Component" :is-logged-in="isLoggedIn" :current-username="currentUsername" />
      </router-view>
    </main>

    <footer class="site-footer">
      <p class="disclaimer">
        Fasskoll är en fristående, ej officiell tjänst. Donationer är frivilliga och ger inga extra funktioner.
      </p>
      <DonationLink />
    </footer>

    <Analytics />
  </div>
</template>

<style scoped>
.site {
  min-height: 100vh;
  display: grid;
  grid-template-rows: auto 1fr auto;
}

.site-header {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  padding: 1rem 1.5rem;
  border-bottom: 1px solid var(--line);
  background: linear-gradient(135deg, rgba(255, 255, 255, 0.96) 0%, rgba(248, 251, 255, 0.92) 100%);
  backdrop-filter: blur(8px);
  position: sticky;
  top: 0;
  z-index: 10;
}

.header-left {
  justify-self: start;
}

.header-center {
  justify-self: center;
  display: flex;
  align-items: center;
  gap: 1rem;
}

.header-right {
  justify-self: end;
  display: flex;
  align-items: center;
  gap: 1rem;
}

.brand {
  margin: 0;
  font-size: 1.35rem;
  font-weight: 800;
  letter-spacing: 0.02em;
}

.brand-link {
  color: var(--text);
  text-decoration: none;
}

.header-center a,
.header-right a {
  color: var(--primary);
  text-decoration: none;
  font-weight: 700;
}

.site-main {
  padding: 1.5rem;
}

.site-footer {
  position: sticky;
  bottom: 0;
  z-index: 9;
  padding: 1rem 1.5rem 1.4rem;
  border-top: 1px solid var(--line);
  border-bottom: 1px solid var(--line);
  background: linear-gradient(135deg, rgba(255, 255, 255, 0.96) 0%, rgba(248, 251, 255, 0.92) 100%);
  backdrop-filter: blur(8px);
  display: grid;
  gap: 0.7rem;
}

.disclaimer {
  margin: 0;
  color: #31486c;
  font-size: 0.96rem;
  line-height: 1.45;
  font-weight: 700;
}

.panel {
  max-width: 460px;
  padding: 1.5rem;
  border-radius: var(--radius);
  background: var(--surface);
  border: 1px solid var(--line);
  box-shadow: var(--shadow);
}

h1 {
  margin-top: 0;
  margin-bottom: 0.75rem;
}

.login-form {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
}

.login-form input {
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 0.7rem 0.8rem;
  background: var(--surface-strong);
}

button {
  margin-top: 0.75rem;
  border: none;
  border-radius: 10px;
  padding: 0.7rem 1rem;
  background: linear-gradient(135deg, var(--primary) 0%, var(--primary-strong) 100%);
  color: #fff;
  font-weight: 600;
  cursor: pointer;
}

.error {
  color: var(--danger);
}

@media (max-width: 1024px), (hover: none) and (pointer: coarse) {
  .site-header {
    grid-template-columns: 1fr;
    gap: 0.45rem;
  }

  .header-left,
  .header-center,
  .header-right {
    justify-self: start;
  }

  .site-footer {
    position: static !important;
    bottom: auto !important;
    z-index: auto !important;
    padding: 0.8rem 1rem 1rem;
  }
}
</style>
