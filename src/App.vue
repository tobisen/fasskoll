<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useRouter } from "vue-router";

const EXPECTED_USERNAME = "Jenny&Tobbe";
const EXPECTED_PASSWORD = "VivaLaAi";
const LOGIN_STORAGE_KEY = "fasskoll_logged_in";

const username = ref("");
const password = ref("");
const isLoggedIn = ref(false);
const error = ref("");
const router = useRouter();

function handleLogin() {
  if (
    username.value === EXPECTED_USERNAME &&
    password.value === EXPECTED_PASSWORD
  ) {
    isLoggedIn.value = true;
    localStorage.setItem(LOGIN_STORAGE_KEY, "true");
    error.value = "";
    router.push({
      path: "/search",
      query: {
        packageId: "20040607005750",
        zipCode: "75318",
        autostart: "1",
      },
    });
    return;
  }

  error.value = "Fel användarnamn eller lösenord.";
}

function handleHomeClick() {
  if (isLoggedIn.value) {
    window.location.href = "/";
    return;
  }

  username.value = "";
  password.value = "";
  error.value = "";
}

function handleLogout() {
  isLoggedIn.value = false;
  localStorage.removeItem(LOGIN_STORAGE_KEY);
  username.value = "";
  password.value = "";
  error.value = "";
  window.location.href = "/";
}

onMounted(() => {
  isLoggedIn.value = localStorage.getItem(LOGIN_STORAGE_KEY) === "true";
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
          v-if="isLoggedIn"
          :to="{
            path: '/search',
            query: {
              packageId: '20040607005750',
              zipCode: '75318',
              autostart: '1',
            },
          }"
        >
          Estradot
        </router-link>
      </nav>

      <div class="header-right">
        <span class="status">
          {{ isLoggedIn ? "Status: Inloggad" : "Status: Inte inloggad" }}
        </span>
        <a v-if="isLoggedIn" href="#" @click.prevent="handleLogout">Logga ut</a>
      </div>
    </header>

    <main class="site-main">
      <section v-if="!isLoggedIn" class="panel">
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

      <router-view v-else />
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

.status {
  font-size: 0.9rem;
  color: var(--muted);
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
