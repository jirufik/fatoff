<script setup lang="ts">
/**
 * Разделы аккаунта — единственная навигация внутри него.
 *
 * Раньше их было три: ссылки в шапке, ряд кнопок на странице аккаунта и
 * хлебные крошки на остальных страницах. Все три вели примерно туда же, но
 * выглядели по-разному, и в каждом окне казалось, что это разные меню. Здесь
 * они собраны в одну полосу, живущую в раскладке: значит, во всех окнах она
 * одна и та же и стоит на одном месте.
 */
defineProps<{ id: string; label?: string | null }>()

const { t } = useI18n()

const SECTIONS: Array<{ to: string; key: string; icon: string }> = [
  { to: '', key: 'nav.overview', icon: 'gauge' },
  { to: '/journal', key: 'nav.journal', icon: 'calendar' },
  { to: '/planner', key: 'nav.planner', icon: 'sliders' },
  { to: '/plans', key: 'nav.plans', icon: 'archive' },
  { to: '/guide', key: 'nav.guide', icon: 'info' },
  { to: '/data', key: 'nav.data', icon: 'search' },
  { to: '/sync', key: 'nav.sync', icon: 'swap' },
  { to: '/export', key: 'nav.export', icon: 'save' },
]
</script>

<template>
  <nav class="account-nav" aria-label="Разделы аккаунта">
    <span v-if="label" class="account-nav__who" :title="label">{{ label }}</span>
    <NuxtLink
      v-for="section in SECTIONS"
      :key="section.to"
      :to="`/accounts/${id}${section.to}`"
      class="account-nav__link"
      :class="{ 'account-nav__link--on': $route.path === `/accounts/${id}${section.to}` }"
    >
      <AppIcon :name="section.icon" :size="14" />
      {{ t(section.key) }}
    </NuxtLink>
  </nav>
</template>

<style scoped>
.account-nav {
  display: flex;
  align-items: center;
  gap: 0.2rem;
  flex-wrap: wrap;
  padding: 0.35rem 1.25rem;
  background: var(--surface);
  border-bottom: 1px solid var(--line-soft);
  position: sticky;
  top: 3rem;
  z-index: 9;
}
.account-nav__who {
  max-width: 14rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  margin-right: 0.6rem;
  padding-right: 0.6rem;
  border-right: 1px solid var(--line);
  font-family: var(--font-mono);
  font-size: 0.74rem;
  color: var(--ink-3);
}
.account-nav__link {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.3rem 0.65rem;
  border-radius: 999px;
  color: var(--ink-2);
  text-decoration: none;
  font-size: 0.84rem;
  font-weight: 500;
  transition: background 0.15s, color 0.15s;
}
.account-nav__link:hover {
  background: var(--sunk);
  color: var(--ink);
}
.account-nav__link--on {
  background: var(--accent-bg);
  color: var(--accent-ink);
  font-weight: 600;
}

@media (max-width: 46rem) {
  /*
   * На узком экране полоса переносится, а не уезжает вбок. Боковая прокрутка
   * прятала половину разделов: увидеть их можно было, только догадавшись
   * потянуть полосу пальцем.
   */
  .account-nav {
    top: auto;
    position: static;
    padding: 0.4rem 0.7rem;
    gap: 0.25rem;
  }
  .account-nav__who {
    display: none;
  }
  .account-nav__link {
    flex: 1 1 auto;
    justify-content: center;
    min-height: 36px;
    padding: 0.3rem 0.55rem;
    font-size: 0.8rem;
  }
}
</style>
