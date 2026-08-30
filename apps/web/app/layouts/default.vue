<script setup lang="ts">
import type { AccountDto } from '@fatoff/contracts'

const route = useRoute()
const api = useApi()
const { restore } = useTheme()
const { restore: restoreLocale } = useI18n()

/** Разделы аккаунта живут в той же полосе, что и всё остальное (D-067). */
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
    <TopNav v-if="route.path !== '/login'" :account-id="accountId" :account="account" />
    <main class="page">
      <slot />
    </main>
  </div>
</template>
