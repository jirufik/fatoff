<script setup lang="ts">
const { login } = useAuth()
const { t } = useI18n()

const password = ref('')
const error = ref('')
const busy = ref(false)

async function submit(): Promise<void> {
  busy.value = true
  error.value = ''
  try {
    await login(password.value)
  } catch (caught) {
    error.value = errorMessage(caught)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="login">
    <h1>{{ t('login.title') }}</h1>
    <p class="lede">{{ t('login.lede', { file: '.env' }) }}</p>

    <form class="card" @submit.prevent="submit">
      <div v-if="error" class="alert alert--bad">{{ error }}</div>

      <label class="field">
        <span>{{ t('login.password') }}</span>
        <input v-model="password" type="password" autocomplete="current-password" autofocus />
      </label>

      <button type="submit" class="btn btn--primary btn--wide" :disabled="busy || !password">
        <span v-if="busy" class="spinner" />
        {{ t('login.submit') }}
      </button>
    </form>
  </div>
</template>

<style scoped>
.login {
  max-width: 22rem;
  margin: 3rem auto 0;
}
</style>
