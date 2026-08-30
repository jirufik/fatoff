<script setup lang="ts">
import type { AccountDto } from '@fatoff/contracts'

/**
 * Единственная полоса навигации.
 *
 * Раньше их было две, одна под другой: сервисная (аккаунты, выгрузки, поля,
 * выход) и разделы аккаунта. Вместе они съедали 269 пикселей на мониторе и
 * 525 на телефоне — до содержимого приходилось прокручивать две трети экрана
 * (D-067).
 *
 * Восемь разделов в строку не помещаются даже на широком экране, поэтому
 * четыре главных видны, остальные под «Ещё», а сервисное — под шестерёнкой.
 * На узком экране разделы схлопываются в один список: полоса остаётся в одну
 * строку.
 */
const props = defineProps<{ accountId: string | null; account: AccountDto | null }>()

const { t } = useI18n()
const route = useRoute()
const api = useApi()
const { logout } = useAuth()

/** Разделы аккаунта. Первые четыре видны всегда, остальные — под «Ещё». */
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
const PRIMARY = 4

const link = (section: { to: string }): string => `/accounts/${props.accountId}${section.to}`

/**
 * Какой раздел открыт.
 *
 * Сравнение по самому длинному совпавшему пути: у «Обзора» путь пустой и
 * совпал бы с любым другим разделом.
 */
const current = computed(() => {
  if (!props.accountId) return null
  const matched = SECTIONS.filter((section) => {
    const path = link(section)
    return route.path === path || route.path.startsWith(`${path}/`)
  })
  return matched.sort((a, b) => b.to.length - a.to.length)[0] ?? null
})

const primary = computed(() => SECTIONS.slice(0, PRIMARY))
const secondary = computed(() => SECTIONS.slice(PRIMARY))

/** Открыто ли «Ещё»: подсвечиваем, когда активен раздел из-под него. */
const inMore = computed(() => secondary.value.some((section) => section === current.value))

const open = ref<'sections' | 'more' | 'service' | 'account' | null>(null)
const close = (): void => {
  open.value = null
}

// список аккаунтов нужен только для переключателя — берём при первом открытии
const accounts = ref<AccountDto[] | null>(null)
async function openAccounts(): Promise<void> {
  open.value = open.value === 'account' ? null : 'account'
  if (open.value === 'account' && !accounts.value) {
    accounts.value = await api.get<AccountDto[]>('/accounts').catch(() => [])
  }
}

const name = computed(() => props.account?.label || props.account?.email || '')

watch(() => route.path, close)
onMounted(() => window.addEventListener('keydown', onEscape))
onBeforeUnmount(() => window.removeEventListener('keydown', onEscape))
function onEscape(event: KeyboardEvent): void {
  if (event.key === 'Escape') close()
}
</script>

<template>
  <header class="bar">
    <NuxtLink to="/" class="brand">{{ t('app.name') }}</NuxtLink>

    <!-- ── аккаунт: имя и переключение ─────────────────────────────────── -->
    <div v-if="accountId" class="drop">
      <button class="who" type="button" :aria-expanded="open === 'account'" @click="openAccounts">
        <span class="who__name">{{ name }}</span>
        <span class="caret">▾</span>
      </button>
      <template v-if="open === 'account'">
        <div class="scrim" @click="close" />
        <div class="menu">
          <NuxtLink
            v-for="item in accounts ?? []"
            :key="item.id"
            class="menu__item"
            :class="{ 'menu__item--on': item.id === accountId }"
            :to="`/accounts/${item.id}`"
          >
            {{ item.label || item.email }}
          </NuxtLink>
          <hr />
          <NuxtLink class="menu__item" to="/">{{ t('nav.accounts') }}</NuxtLink>
        </div>
      </template>
    </div>

    <!-- ── разделы: на широком экране вразбивку, на узком одним списком ── -->
    <nav v-if="accountId" class="bar__sections" :aria-label="t('nav.sections')">
      <NuxtLink
        v-for="section in primary"
        :key="section.to"
        class="pill"
        :class="{ 'pill--on': section === current }"
        :to="link(section)"
      >
        <AppIcon :name="section.icon" :size="14" />
        {{ t(section.key) }}
      </NuxtLink>

      <div class="drop">
        <button
          class="pill"
          :class="{ 'pill--on': inMore }"
          type="button"
          :aria-expanded="open === 'more'"
          @click="open = open === 'more' ? null : 'more'"
        >
          {{ t('nav.more') }}<span class="caret">▾</span>
        </button>
        <template v-if="open === 'more'">
          <div class="scrim" @click="close" />
          <div class="menu">
            <NuxtLink
              v-for="section in secondary"
              :key="section.to"
              class="menu__item"
              :class="{ 'menu__item--on': section === current }"
              :to="link(section)"
            >
              <AppIcon :name="section.icon" :size="14" />
              {{ t(section.key) }}
            </NuxtLink>
          </div>
        </template>
      </div>
    </nav>

    <!-- на узком экране весь список разделов прячется под текущий -->
    <div v-if="accountId" class="drop drop--narrow">
      <button
        class="pill pill--on"
        type="button"
        :aria-expanded="open === 'sections'"
        @click="open = open === 'sections' ? null : 'sections'"
      >
        <span class="pill__label">{{ current ? t(current.key) : t('nav.sections') }}</span>
        <span class="caret">▾</span>
      </button>
      <template v-if="open === 'sections'">
        <div class="scrim" @click="close" />
        <div class="menu">
          <template v-for="(section, index) in SECTIONS" :key="section.to">
            <NuxtLink
              class="menu__item"
              :class="{ 'menu__item--on': section === current }"
              :to="link(section)"
            >
              <AppIcon :name="section.icon" :size="14" />
              {{ t(section.key) }}
            </NuxtLink>
            <!-- черта отделяет главные разделы от прочих, как на широком экране -->
            <hr v-if="index === PRIMARY - 1" />
          </template>
        </div>
      </template>
    </div>

    <span class="grow" />

    <!-- ── сервисное: выгрузки, поля, язык, тема, выход ────────────────── -->
    <div class="drop">
      <button
        class="gear"
        type="button"
        :title="t('nav.settings')"
        :aria-label="t('nav.settings')"
        :aria-expanded="open === 'service'"
        @click="open = open === 'service' ? null : 'service'"
      >
        <AppIcon name="sliders" :size="16" />
      </button>
      <template v-if="open === 'service'">
        <div class="scrim" @click="close" />
        <div class="menu menu--wide">
          <NuxtLink class="menu__item" to="/">{{ t('nav.accounts') }}</NuxtLink>
          <NuxtLink class="menu__item" to="/exports">{{ t('nav.exports') }}</NuxtLink>
          <NuxtLink class="menu__item" to="/fields">{{ t('nav.fields') }}</NuxtLink>
          <hr />
          <ThemeToggle />
          <hr />
          <button class="menu__item" type="button" @click="logout">{{ t('nav.logout') }}</button>
        </div>
      </template>
    </div>
  </header>
</template>

<style scoped>
.bar {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  min-height: 46px;
  padding: 0.4rem 1.25rem;
  padding-top: max(0.4rem, env(safe-area-inset-top));
  background: color-mix(in oklab, var(--bg) 82%, transparent);
  backdrop-filter: saturate(180%) blur(12px);
  border-bottom: 1px solid var(--line-soft);
  position: sticky;
  top: 0;
  z-index: 10;
}

.brand {
  font-family: var(--font-mono);
  font-weight: 700;
  font-size: 0.92rem;
  letter-spacing: -0.03em;
  color: var(--ink);
  text-decoration: none;
  flex: none;
}

.grow {
  flex: 1;
}

/* переключатель аккаунта: имя может быть длинным, обрезаем */
.who {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  max-width: 12rem;
  min-height: 30px;
  padding: 0 0.55rem;
  border: 1px solid var(--line);
  border-radius: 999px;
  background: var(--surface);
  color: var(--ink-2);
  font: inherit;
  font-size: 0.82rem;
  cursor: pointer;
}
.who:hover {
  border-color: color-mix(in oklab, var(--accent) 45%, var(--line));
  color: var(--ink);
}
.who__name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.bar__sections {
  display: flex;
  align-items: center;
  gap: 0.1rem;
  min-width: 0;
}

.pill {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  min-height: 30px;
  padding: 0 0.6rem;
  border: none;
  border-radius: 999px;
  background: none;
  color: var(--ink-2);
  font: inherit;
  font-size: 0.85rem;
  font-weight: 500;
  text-decoration: none;
  white-space: nowrap;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}
.pill:hover {
  background: var(--sunk);
  color: var(--ink);
}
.pill--on {
  background: var(--accent-bg);
  color: var(--accent-ink);
  font-weight: 600;
}
.caret {
  font-size: 0.62rem;
  opacity: 0.7;
  flex: none;
}

/*
 * Название текущего раздела на телефоне сжимается до многоточия.
 *
 * Без этого «Как это работает» распирало строку на 385px при экране в 360 и
 * шестерёнка уезжала за край: строка из nowrap-кнопок ужаться не может.
 */
.pill__label {
  overflow: hidden;
  text-overflow: ellipsis;
}

.gear {
  display: inline-grid;
  place-items: center;
  width: 32px;
  height: 32px;
  flex: none;
  border: 1px solid var(--line);
  border-radius: 999px;
  background: var(--surface);
  color: var(--ink-2);
  cursor: pointer;
  transition: background 0.15s, color 0.15s, border-color 0.15s;
}
.gear:hover {
  background: var(--sunk);
  color: var(--ink);
  border-color: color-mix(in oklab, var(--accent) 35%, var(--line));
}

/* ── выпадающие списки ──────────────────────────────────────────────── */
.drop {
  position: relative;
  flex: none;
}
.drop--narrow {
  display: none;
}
.scrim {
  position: fixed;
  inset: 0;
  z-index: 20;
}
.menu {
  position: absolute;
  top: calc(100% + 0.4rem);
  left: 0;
  z-index: 21;
  min-width: 13rem;
  padding: 0.35rem;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  box-shadow: var(--shadow-lift);
}
.menu--wide {
  left: auto;
  right: 0;
  min-width: 17rem;
}
.menu hr {
  border: 0;
  border-top: 1px solid var(--line-soft);
  margin: 0.3rem 0;
}
.menu__item {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  width: 100%;
  padding: 0.42rem 0.55rem;
  border: none;
  border-radius: var(--radius-xs);
  background: none;
  color: var(--ink-2);
  font: inherit;
  font-size: 0.86rem;
  text-align: left;
  text-decoration: none;
  cursor: pointer;
}
.menu__item:hover {
  background: var(--sunk);
  color: var(--ink);
}
.menu__item--on {
  background: var(--accent-bg);
  color: var(--accent-ink);
  font-weight: 600;
}

@media (max-width: 50rem) {
  /* разделы вразбивку не помещаются — весь список уходит под текущий */
  .bar__sections {
    display: none;
  }
  .drop--narrow {
    display: block;
    /* уступает место шестерёнке, а не выталкивает её за край */
    flex: 0 1 auto;
    min-width: 0;
  }
  .drop--narrow .pill {
    max-width: 100%;
  }
}

@media (max-width: 46rem) {
  .bar {
    gap: 0.35rem;
    padding: 0.35rem 0.7rem;
    padding-top: max(0.35rem, env(safe-area-inset-top));
  }
  .who {
    max-width: 7.5rem;
  }
  .brand {
    font-size: 0.85rem;
  }
  .menu {
    /* на узком экране список во всю ширину, а не колонкой у края */
    left: 0;
    right: 0;
    position: fixed;
    top: auto;
    margin: 0.35rem 0.7rem;
    min-width: 0;
  }
}

/*
 * На совсем узких экранах имя аккаунта уступает место названию раздела.
 *
 * Аккаунт обычно один и человек его знает; раздел — то, по чему он понимает,
 * где находится, и обрезать надо в последнюю очередь именно его.
 */
@media (max-width: 24rem) {
  .who {
    max-width: 5.25rem;
  }
}
</style>
