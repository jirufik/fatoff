<script setup lang="ts">
import type { AccountDto } from '@fatoff/contracts'

const api = useApi()
const { t } = useI18n()
const router = useRouter()

/** Пароля у аккаунта может не быть вовсе — например, если вход через Apple ID. */
const mode = ref<'password' | 'token'>('password')

const email = ref('')
const password = ref('')
const accessToken = ref('')
const refreshToken = ref('')
const label = ref('')
const error = ref('')
const busy = ref(false)

const ready = computed(() =>
  mode.value === 'password' ? Boolean(email.value && password.value) : accessToken.value.length > 8,
)

/**
 * В поле токена можно вставить целиком ответ `/api/auth/token` из инструментов
 * разработчика — оба значения разложатся сами. Копировать по одному из JSON
 * руками — лишний повод ошибиться.
 */
watch(accessToken, (value) => {
  const trimmed = value.trim()
  if (!trimmed.startsWith('{')) return
  try {
    const parsed = JSON.parse(trimmed) as { access_token?: string; refresh_token?: string }
    if (!parsed.access_token) return
    accessToken.value = parsed.access_token
    if (parsed.refresh_token) refreshToken.value = parsed.refresh_token
  } catch {
    // не JSON — значит, человек ещё дописывает; не мешаем
  }
})

async function submit(): Promise<void> {
  busy.value = true
  error.value = ''
  try {
    const account = await api.post<AccountDto>('/accounts', {
      email: email.value.trim(),
      label: label.value.trim() || undefined,
      ...(mode.value === 'password'
        ? { password: password.value }
        : {
            accessToken: accessToken.value.trim(),
            refreshToken: refreshToken.value.trim() || undefined,
          }),
    })
    await router.push(`/accounts/${account.id}`)
  } catch (caught) {
    error.value = errorMessage(caught)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="narrow">
    <h1>{{ t('newAccount.title') }}</h1>
    <p class="lede">{{ t('newAccount.lede') }}</p>

    <div class="modes">
      <button
        class="mode"
        :class="{ 'mode--on': mode === 'password' }"
        type="button"
        @click="mode = 'password'"
      >
        {{ t('newAccount.byPassword') }}
      </button>
      <button
        class="mode"
        :class="{ 'mode--on': mode === 'token' }"
        type="button"
        @click="mode = 'token'"
      >
        {{ t('newAccount.byToken') }}
      </button>
    </div>

    <form class="card" @submit.prevent="submit">
      <div v-if="error" class="alert alert--bad">{{ error }}</div>

      <template v-if="mode === 'password'">
        <label class="field">
          <span>{{ t('newAccount.email') }}</span>
          <input v-model="email" type="email" autocomplete="username" required />
        </label>

        <label class="field">
          <span>{{ t('newAccount.password') }}</span>
          <input v-model="password" type="password" autocomplete="off" required />
        </label>
      </template>

      <template v-else>
        <p class="tiny" style="margin-top: 0">
          {{ t('newAccount.token.note', { endpoint: '/api/auth/token' }) }}
        </p>

        <label class="field">
          <span>Access token</span>
          <input v-model="accessToken" type="text" autocomplete="off" spellcheck="false" required />
        </label>

        <label class="field">
          <span>{{ t('newAccount.refresh') }}</span>
          <input v-model="refreshToken" type="text" autocomplete="off" spellcheck="false" />
        </label>

        <p class="tiny" style="margin-top: -0.4rem">{{ t('newAccount.refresh.note') }}</p>

        <details class="howto" open>
          <summary>{{ t('newAccount.howto') }}</summary>
          <ol>
            <!-- ссылка и клавиша остаются разметкой: подставлять теги строкой
                 из словаря — верный способ однажды подставить чужой HTML -->
            <li>
              <i18n-parts :text="t('newAccount.howto.1', { link: '{link}', key: '{key}' })">
                <template #link>
                  <a href="https://www.yazio.com/en/app/account/login" target="_blank" rel="noopener">
                    yazio.com/en/app/account/login
                  </a>
                </template>
                <template #key><kbd>F12</kbd></template>
              </i18n-parts>
            </li>
            <li>{{ t('newAccount.howto.2') }}</li>
            <li>
              <i18n-parts :text="t('newAccount.howto.3', { request: '{request}' })">
                <template #request><code>POST /api/auth/token</code></template>
              </i18n-parts>
            </li>
            <li>
              <i18n-parts
                :text="t('newAccount.howto.4', { access: '{access}', refresh: '{refresh}' })"
              >
                <template #access><code>access_token</code></template>
                <template #refresh><code>refresh_token</code></template>
              </i18n-parts>
            </li>
          </ol>
          <p style="margin: 0.6rem 0 0">{{ t('newAccount.howto.note') }}</p>
        </details>
      </template>

      <label class="field">
        <span>{{ t('newAccount.label') }}</span>
        <input v-model="label" type="text" :placeholder="t('newAccount.label.hint')" maxlength="64" />
      </label>

      <p class="tiny" style="margin-top: -0.4rem">
        {{ t('newAccount.secrets', { file: '.env' }) }}
      </p>

      <button type="submit" class="btn btn--primary btn--wide" :disabled="busy || !ready">
        <span v-if="busy" class="spinner" />
        {{ t('newAccount.submit') }}
      </button>
    </form>
  </div>
</template>

<style scoped>
.narrow {
  max-width: 32rem;
}

.modes {
  display: flex;
  gap: 0.3rem;
  margin-bottom: 0.75rem;
}
.mode {
  flex: 1;
  min-height: 38px;
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  background: var(--surface);
  color: var(--ink-2);
  font: inherit;
  font-size: 0.9rem;
  font-weight: 600;
  cursor: pointer;
}
.mode--on {
  border-color: var(--accent);
  background: var(--accent-bg);
  color: var(--accent);
}

.howto {
  margin-bottom: 0.85rem;
  font-size: 0.85rem;
  color: var(--ink-2);
}
.howto summary {
  cursor: pointer;
  color: var(--accent);
}
.howto ol {
  margin: 0.5rem 0 0;
  padding-left: 1.1rem;
}
.howto li + li {
  margin-top: 0.5rem;
}
</style>
