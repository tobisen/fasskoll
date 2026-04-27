<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useRouter } from "vue-router";

const username = ref("");
const password = ref("");
const isLoggedIn = ref(false);
const authLoading = ref(true);
const showLoginForm = ref(false);
const error = ref("");
const router = useRouter();

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
  } catch {
    isLoggedIn.value = false;
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

function handleHomeClick() {
  if (isLoggedIn.value) {
    window.location.href = "/";
    return;
  }

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
  authLoading.value = false;
});
</script>

<template>
  <div class="site">
    <header class="site-header">
      <div class="header-left">
        <button class="brand brand-button" type="button" @click="handleHomeClick">
          Fasskoll
        </button>
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
      </nav>

      <div class="header-right">
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
        <component :is="Component" :is-logged-in="isLoggedIn" />
      </router-view>
    </main>
  </div>
</template>

<style scoped>
.site {
  min-height: 100vh;
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

.brand-button {
  border: none;
  background: transparent;
  color: var(--text);
  padding: 0;
  cursor: pointer;
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

@media (max-width: 860px) {
  .site-header {
    grid-template-columns: 1fr;
    gap: 0.45rem;
  }

  .header-left,
  .header-center,
  .header-right {
    justify-self: start;
  }
}
</style>
