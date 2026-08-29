<script setup lang="ts">
import type { AccountDto } from '@fatoff/contracts'

const route = useRoute()
const api = useApi()
const { logout } = useAuth()
const { restore } = useTheme()
const { restore: restoreLocale, t } = useI18n()

const showNav = computed(() => route.path !== '/login')

/** Внутри аккаунта под шапкой висит полоса его разделов — одна на все страницы. */
const accountId = computed(() => {
  const match = /^\/accounts\/([0-9a-f-]{36})(\/|$)/.exec(route.path)
  return match?.[1] ?? null
})

const account = ref<AccountDto | null>(null)

watch(
  accountId,
  async (id) => {
    if (!id) {
      account.value = null
      return
    }
    if (account.value?.id === id) return
    try {
      account.value = await api.get<AccountDto>(`/accounts/${id}`)
    } catch {
      account.value = null
    }
  },
  { immediate: true },
)

onMounted(() => {
  restore()
  restoreLocale()
})
</script>

<template>
  <div class="shell">
    <header class="topbar">
      <NuxtLink to="/" class="brand">{{ t('app.name') }}</NuxtLink>
      <nav>
        <template v-if="showNav">
          <NuxtLink to="/">{{ t('nav.accounts') }}</NuxtLink>
          <NuxtLink to="/exports">{{ t('nav.exports') }}</NuxtLink>
          <NuxtLink to="/fields">{{ t('nav.fields') }}</NuxtLink>
          <a href="#" @click.prevent="logout">{{ t('nav.logout') }}</a>
        </template>
        <ThemeToggle />
      </nav>
    </header>
    <AccountNav v-if="accountId" :id="accountId" :label="account?.label || account?.email" />
    <main class="page">
      <slot />
    </main>
  </div>
</template>
