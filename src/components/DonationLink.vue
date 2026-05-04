<script setup lang="ts">
import { computed } from "vue";

const kofiUrl = computed(() => (import.meta.env.VITE_KOFI_URL ?? "").trim());
const shouldShow = computed(() => kofiUrl.value.length > 0);
</script>

<template>
  <section v-if="shouldShow" class="donation-link" aria-label="Donation">
    <h3>Vill du hjälpa Fasskoll att finnas kvar?</h3>
    <p>
      Fasskoll är gratis för alla. Om du vill kan du stötta drift och vidareutveckling med en frivillig donation.
    </p>
    <a :href="kofiUrl" target="_blank" rel="noopener noreferrer">Stötta via Ko-fi</a>
    <small>Helt frivilligt. Du får samma funktioner oavsett donation.</small>
  </section>
</template>

<style scoped>
.donation-link {
  display: grid;
  gap: 0.6rem;
  padding: 0.9rem;
  border: 1px solid var(--line);
  border-radius: 12px;
  background: linear-gradient(180deg, #ffffff 0%, #f6f9ff 100%);
  font-size: 1rem;
  color: #263a59;
}

.donation-link h3 {
  margin: 0;
  font-size: 1.05rem;
  color: #16345f;
}

.donation-link p {
  margin: 0;
  line-height: 1.4;
}

.donation-link a {
  color: #fff;
  text-decoration: none;
  font-weight: 700;
  display: inline-block;
  width: fit-content;
  border: 1px solid #005a9c;
  background: linear-gradient(135deg, #0a6fbc 0%, #005a9c 100%);
  padding: 0.52rem 0.78rem;
  border-radius: 10px;
}

.donation-link small {
  color: #4d6180;
  font-size: 0.86rem;
}
</style>
