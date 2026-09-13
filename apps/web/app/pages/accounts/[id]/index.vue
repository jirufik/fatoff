<script setup lang="ts">
import {
  BALANCE_EVEN_KCAL,
  DEFICIT_CORRIDOR,
  FULL_DAY_MEALS,
  HOME_BALANCE_WINDOW_DAYS,
  MEAL_TITLES,
  balanceZone,
} from '@fatoff/contracts'
import type {
  AccountDto,
  BalanceZone,
  DriveSettingsDto,
  HealthImportDto,
  HomeDto,
  MealKey,
  PeriodSummaryDto,
  PeriodValueDto,
  SyncRunDto,
} from '@fatoff/contracts'

/**
 * Главный экран аккаунта — по макету заказчика (D-083).
 *
 * Сверху вниз: приветствие, свежесть данных с кнопкой синхронизации, баланс
 * последнего полного дня, последние дни с графиком, тренировки недели, питание
 * сегодня, анализ словами — и разделы в самом конце, свёрнутыми.
 *
 * Считает всё сервер. Страница раскладывает числа и подписывает у каждого,
 * откуда оно взялось и по скольким дням посчитано (D-079, D-082).
 */
const api = useApi()
const route = useRoute()
const { t, message, pick, locale } = useI18n()
const id = route.params.id as string

const account = ref<AccountDto | null>(null)
const home = ref<HomeDto | null>(null)
const summary = ref<PeriodSummaryDto | null>(null)
const error = ref('')
const notice = ref('')

// ── даты ─────────────────────────────────────────────────────────────────────

const isoOf = (at: Date): string =>
  `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, '0')}-${String(at.getDate()).padStart(2, '0')}`

/** Сегодня по часам браузера: сервер в контейнере живёт по UTC. */
const todayIso = (): string => isoOf(new Date())

const intl = computed(() => (locale.value === 'en' ? 'en-GB' : 'ru-RU'))
const dateOf = (iso: string): Date => new Date(`${iso}T00:00:00`)
const dayMonth = (iso: string): string =>
  dateOf(iso).toLocaleDateString(intl.value, { day: 'numeric', month: 'long' })
const daysSince = (iso: string, until: string): number =>
  Math.round((dateOf(until).getTime() - dateOf(iso).getTime()) / 86_400_000)

const num = (value: number | null | undefined, digits = 0): string =>
  value === null || value === undefined
    ? '—'
    : value.toLocaleString('ru-RU', { maximumFractionDigits: digits })

/** Со знаком: «−348» читается как баланс, «348» — как непонятно что. */
const signed = (value: number | null | undefined): string => {
  if (value === null || value === undefined) return '—'
  const rounded = Math.round(value)
  const sign = rounded > 0 ? '+' : rounded < 0 ? '−' : ''
  return `${sign}${num(Math.abs(rounded))}`
}

/** Доля до цели для полоски: перебор полоску не удлиняет, он виден в числе. */
const share = (value: number | null | undefined, goal: number | null | undefined): string =>
  value === null || value === undefined || !goal ? '0%' : `${Math.min(100, Math.round((value / goal) * 100))}%`

// ── приветствие ──────────────────────────────────────────────────────────────

const helloDate = computed(() => {
  const text = new Date().toLocaleDateString(intl.value, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  })
  return text.charAt(0).toUpperCase() + text.slice(1)
})

/**
 * Буква в кружке вместо фото.
 *
 * Фото из профиля YAZIO лежит на чужом сервере, и подгружать его значило бы
 * сообщать туда, что кто-то открыл страницу с данными о здоровье. Со страниц
 * сервиса наружу не уходит ни одного запроса — главный экран не исключение.
 */
const initial = computed(() => {
  const source = home.value?.firstName || account.value?.label || account.value?.email || '?'
  return (Array.from(source.trim())[0] ?? '?').toUpperCase()
})

// ── свежесть данных и синхронизация ──────────────────────────────────────────

/** YAZIO свеж, если синхронизировался за двое суток: расписание ходит раз в день. */
const FRESH_SYNC_HOURS = 48
/** Часы свежи, если известны хотя бы по позавчерашний день: выгрузку делают руками. */
const FRESH_WATCH_DAYS = 2

const syncOpen = ref(false)

const when = (iso: string): string => {
  const at = new Date(iso)
  const time = at.toLocaleTimeString(intl.value, { hour: '2-digit', minute: '2-digit' })
  const day = isoOf(at)
  const yesterday = new Date()
  yesterday.setDate(yesterday.getDate() - 1)

  if (day === todayIso()) return t('home.sync.today', { time })
  if (day === isoOf(yesterday)) return t('home.sync.yesterday', { time })
  return `${at.toLocaleDateString(intl.value, { day: 'numeric', month: 'long' })}, ${time}`
}

const yazioFresh = computed(() => {
  const yazio = home.value?.freshness.yazio
  if (!yazio?.syncedAt || yazio.status === 'failed') return false
  return Date.now() - new Date(yazio.syncedAt).getTime() < FRESH_SYNC_HOURS * 3_600_000
})

/** `null` — Apple Health не загружался вовсе: устаревшим такое не назовёшь. */
const healthFresh = computed(() => {
  const dataTo = home.value?.freshness.health.dataTo
  if (!home.value || !dataTo) return null
  return daysSince(dataTo, home.value.today) <= FRESH_WATCH_DAYS
})

const overallFresh = computed(() => yazioFresh.value && healthFresh.value !== false)

const staleNote = computed(() => {
  const dataTo = home.value?.freshness.health.dataTo
  return healthFresh.value === false && dataTo
    ? t('home.sync.stale.note', { date: dayMonth(dataTo) })
    : ''
})

const syncing = ref(false)
let alive = true
onBeforeUnmount(() => {
  alive = false
})

/**
 * Кнопка «Синхронизировать»: YAZIO и папка Google Drive разом.
 *
 * Единственное действие, вернувшееся на обзор (D-083): оно в макете, и его
 * делают чаще всех остальных. Период, расписание и доступ остаются в
 * «Синхронизации».
 */
async function runSync(): Promise<void> {
  syncing.value = true
  error.value = ''
  notice.value = ''
  try {
    const drive = await api.get<DriveSettingsDto>(`/accounts/${id}/drive/settings`).catch(() => null)
    await Promise.all([
      api.post(`/accounts/${id}/sync`, {}).catch((caught: unknown) => {
        // уже идёт по расписанию — это не ошибка: дождёмся её вместе с остальным
        if (!/уже идёт/i.test(errorMessage(caught))) throw caught
      }),
      drive?.url && drive.keyConfigured ? api.post(`/accounts/${id}/drive/check`) : null,
    ])
    await waitIdle()
    await Promise.all([loadHome(), loadSummary()])
    notice.value = t('home.sync.done')
  } catch (caught) {
    error.value = errorMessage(caught)
  } finally {
    syncing.value = false
  }
}

/** Опрос раз в секунду, пока идут выгрузка YAZIO и загрузка Apple Health (D-008). */
async function waitIdle(): Promise<void> {
  const busy = (status?: string): boolean => status === 'queued' || status === 'running'
  for (let attempt = 0; attempt < 900 && alive; attempt++) {
    const [runs, imports] = await Promise.all([
      api.get<SyncRunDto[]>(`/accounts/${id}/sync?limit=1`),
      api.get<HealthImportDto[]>(`/accounts/${id}/health/imports?limit=1`).catch(() => []),
    ])
    if (!busy(runs[0]?.status) && !busy(imports[0]?.status)) return
    await new Promise((resolve) => setTimeout(resolve, 1000))
  }
}

/**
 * Имя аккаунта задаётся здесь же, под подробностями синхронизации.
 *
 * Приветствие берёт имя из профиля YAZIO, а имя аккаунта нужно списку
 * аккаунтов: там бывает «основной» или «дневник жены», и приветствовать так
 * нельзя (D-053, D-083).
 */
const naming = ref(false)
const draftName = ref('')
const saving = ref(false)

function startNaming(): void {
  draftName.value = account.value?.label ?? ''
  naming.value = true
}

async function saveName(): Promise<void> {
  if (!account.value) return
  saving.value = true
  try {
    const label = draftName.value.trim() || null
    await api.patch(`/accounts/${id}`, { label, syncEnabled: account.value.syncEnabled })
    account.value = { ...account.value, label }
    naming.value = false
  } catch (caught) {
    error.value = errorMessage(caught)
  } finally {
    saving.value = false
  }
}

// ── баланс дня ───────────────────────────────────────────────────────────────

/** Цвет зоны — подложкой плашки, текст остаётся чернилами (D-032). */
const ZONE_TONE: Record<BalanceZone, string> = {
  target: 'chip--ok',
  small: 'chip--info',
  even: 'chip--info',
  deep: 'chip--warn',
  surplus: 'chip--bad',
}

/** Шкала баланса: от глубокого дефицита слева до профицита справа. */
const SCALE_MIN = -1000
const SCALE_MAX = 500
const SCALE_TICKS = [-1000, -500, 0, 500]

const scalePos = (value: number): number =>
  ((Math.min(SCALE_MAX, Math.max(SCALE_MIN, value)) - SCALE_MIN) / (SCALE_MAX - SCALE_MIN)) * 100

/** Зоны шкалы строятся из тех же порогов, что и зона дня: нарисовать иначе нельзя. */
const scaleZones = computed(() => {
  const [low, high] = DEFICIT_CORRIDOR
  return [
    { key: 'deep', from: SCALE_MIN, to: -high },
    { key: 'target', from: -high, to: -low },
    { key: 'small', from: -low, to: -BALANCE_EVEN_KCAL },
    { key: 'even', from: -BALANCE_EVEN_KCAL, to: BALANCE_EVEN_KCAL },
    { key: 'surplus', from: BALANCE_EVEN_KCAL, to: SCALE_MAX },
  ].map((zone) => ({
    key: zone.key,
    left: scalePos(zone.from),
    width: scalePos(zone.to) - scalePos(zone.from),
  }))
})

const balanceDay = computed(() => {
  const balance = home.value?.balance
  if (!balance) return ''
  return balance.date === home.value?.today
    ? t('home.balance.today')
    : t('home.balance.on', { date: dayMonth(balance.date) })
})

/** Почему показан не сегодняшний день — сказано прямо, а не оставлено догадываться. */
const balanceNotes = computed(() => {
  const current = home.value
  if (!current?.balance || current.balance.date === current.today) return []
  const { dataTo, completeTo, exportedAt } = current.freshness.health

  const notes = [
    !dataTo || dataTo < current.today
      ? t('home.balance.notToday.health', { date: dataTo ? dayMonth(dataTo) : '—' })
      : t('home.balance.notToday.meals', { count: FULL_DAY_MEALS }),
  ]
  // день сборки выгрузки в ней обрезан — сказать, почему пропущен именно он (D-084)
  if (exportedAt && dataTo && completeTo && completeTo < dataTo) {
    notes.push(
      t('home.balance.partial', { date: dayMonth(exportedAt.slice(0, 10)), time: exportedAt.slice(11, 16) }),
    )
  }
  return notes
})

// ── последние дни ────────────────────────────────────────────────────────────

const PRESETS = [7, 14, 30] as const
const preset = ref<number>(7)
const custom = ref(false)
const from = ref('')
const to = ref('')
const loadingSummary = ref(false)

async function loadSummary(): Promise<void> {
  loadingSummary.value = true
  try {
    const query = new URLSearchParams({ from: from.value, to: to.value })
    summary.value = await api.get<PeriodSummaryDto>(`/accounts/${id}/summary?${query.toString()}`)
  } catch (caught) {
    error.value = errorMessage(caught)
  } finally {
    loadingSummary.value = false
  }
}

/** Последние N дней, считая сегодняшний. */
function choosePreset(days: number): void {
  preset.value = days
  custom.value = false
  const end = new Date()
  const start = new Date(end)
  start.setDate(start.getDate() - (days - 1))
  from.value = isoOf(start)
  to.value = isoOf(end)
  void loadSummary()
}

const periodTitle = computed(() =>
  custom.value && from.value && to.value
    ? t('home.period.range', { from: dayMonth(from.value), to: dayMonth(to.value) })
    : t('home.period.last', { days: preset.value }),
)

const hasPeriodData = computed(
  () => !!summary.value && (summary.value.eaten.days > 0 || summary.value.burned.days > 0),
)

/** Занятий в неделю: «0.6 занятия в день» никому ничего не говорит. */
const perWeek = computed(() => {
  const days = summary.value?.days ?? 0
  if (days === 0) return '0'
  return ((summary.value!.workouts.count / days) * 7).toFixed(1)
})

const periodRows = computed(() => {
  const current = summary.value
  if (!current) return []
  const counted = (value: PeriodValueDto): string =>
    t('home.period.days', { days: value.days, total: current.days })
  // тренировки приходят из Apple Health: за период без единого его дня это «не знаем», а не ноль
  const watchDays = Math.max(current.burned.days, current.steps.days)
  const kcal = t('common.kcal')

  return [
    {
      key: 'eaten',
      mark: '🍽️',
      label: t('home.period.eaten'),
      value: current.eaten.avg === null ? '—' : `${num(current.eaten.avg)} ${kcal}`,
      note: `${counted(current.eaten)} · ${t('home.period.total', { value: num(current.eaten.total) })}`,
    },
    {
      key: 'burned',
      mark: '🔥',
      label: t('home.period.burned'),
      value: current.burned.avg === null ? '—' : `${num(current.burned.avg)} ${kcal}`,
      note: `${counted(current.burned)} · ${t('home.period.total', { value: num(current.burned.total) })}`,
    },
    {
      key: 'balance',
      mark: '⚖️',
      label: t('home.period.balance'),
      value: current.balance.avg === null ? '—' : `${signed(current.balance.avg)} ${kcal}`,
      note: `${counted(current.balance)} · ${t('home.period.total', { value: signed(current.balance.total) })}`,
    },
    {
      key: 'protein',
      mark: '🥩',
      label: t('home.period.protein'),
      value: current.proteinG.avg === null ? '—' : `${num(current.proteinG.avg)} ${t('unit.g')}`,
      note: `${counted(current.proteinG)} · ${t('home.period.total', { value: num(current.proteinG.total) })}`,
    },
    {
      key: 'workouts',
      mark: '🏋️',
      label: t('home.period.workouts'),
      value: watchDays === 0 ? '—' : String(current.workouts.count),
      note:
        watchDays === 0
          ? t('home.period.days', { days: 0, total: current.days })
          : t('home.period.perWeek', { value: perWeek.value, minutes: num(current.workouts.minutes) }),
    },
    {
      key: 'steps',
      mark: '👟',
      label: t('home.period.steps'),
      value: current.steps.avg === null ? '—' : t('home.period.stepsValue', { value: num(current.steps.avg) }),
      note: `${counted(current.steps)} · ${t('home.period.total', { value: num(current.steps.total) })}`,
    },
  ]
})

/** Дефицит, профицит или «ровно» — по среднему балансу за период. */
const periodZone = computed(() => {
  const avg = summary.value?.balance.avg
  return avg === null || avg === undefined ? null : balanceZone(avg)
})
const periodState = computed(() => {
  const zone = periodZone.value
  if (zone === null) return null
  return zone === 'surplus' ? 'surplus' : zone === 'even' ? 'even' : 'deficit'
})

// ── тренировки недели ────────────────────────────────────────────────────────

const weekDone = computed(() => {
  const week = home.value?.week
  return (
    !!week &&
    (week.strength.count ?? 0) >= week.strength.goal &&
    (week.cardio.minutes ?? 0) >= week.cardio.goal
  )
})

const duration = (minutes: number | null): string => {
  if (minutes === null) return '—'
  const hours = Math.floor(minutes / 60)
  return hours > 0
    ? t('home.duration', { h: hours, m: minutes % 60 })
    : `${minutes} ${t('common.min')}`
}

// ── питание сегодня ──────────────────────────────────────────────────────────

/** Значки КБЖУ — те же эмодзи, что везде в сервисе (D-038). */
const FOOD_MACROS = [
  { key: 'protein', field: 'proteinG', mark: '🥩' },
  { key: 'fat', field: 'fatG', mark: '🧈' },
  { key: 'carbs', field: 'carbsG', mark: '🍞' },
] as const

const MEAL_MARKS: Record<string, string> = {
  breakfast: '☀️',
  lunch: '🌤️',
  dinner: '🌙',
  snack: '🍎',
}

const mealTitle = (meal: string): string => pick(MEAL_TITLES[meal as MealKey]) || meal
const capital = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1)

/** Белок — «не меньше», поэтому отметка только у него: жиры и углеводы — «около». */
const proteinReached = computed(() => {
  const food = home.value?.food
  return (
    !!food &&
    food.eaten.proteinG !== null &&
    food.targets.proteinG !== null &&
    food.eaten.proteinG >= food.targets.proteinG
  )
})

// ── разделы ──────────────────────────────────────────────────────────────────

const SECTIONS = [
  { to: '/journal', key: 'nav.journal', note: 'section.journal', icon: 'calendar' },
  { to: '/planner', key: 'nav.planner', note: 'section.planner', icon: 'sliders' },
  { to: '/plans', key: 'nav.plans', note: 'section.plans', icon: 'archive' },
  { to: '/guide', key: 'nav.guide', note: 'section.guide', icon: 'info' },
  { to: '/data', key: 'nav.data', note: 'section.data', icon: 'search' },
  { to: '/sync', key: 'nav.sync', note: 'section.sync', icon: 'swap' },
  { to: '/export', key: 'nav.export', note: 'section.export', icon: 'save' },
]

// ── загрузка ─────────────────────────────────────────────────────────────────

async function loadHome(): Promise<void> {
  home.value = await api.get<HomeDto>(`/accounts/${id}/home?today=${todayIso()}`)
}

onMounted(async () => {
  try {
    ;[account.value] = await Promise.all([api.get<AccountDto>(`/accounts/${id}`), loadHome()])
    choosePreset(7)
  } catch (caught) {
    error.value = errorMessage(caught)
  }
})
</script>

<template>
  <div v-if="account && home" class="home">
    <!-- ── приветствие ──────────────────────────────────────────────────── -->
    <header class="home-hello">
      <span class="home-hello__avatar" aria-hidden="true">{{ initial }}</span>
      <div class="home-hello__text">
        <h1>
          <I18nParts v-if="home.firstName" :text="t('home.hello.name')">
            <template #name>
              <span class="home-hello__name">{{ home.firstName }}</span>
            </template>
          </I18nParts>
          <template v-else>{{ t('home.hello') }}</template>
        </h1>
        <p class="home-hello__date">{{ helloDate }}</p>
      </div>
    </header>

    <div v-if="error" class="alert alert--bad">{{ error }}</div>
    <div v-if="notice" class="alert alert--ok">{{ notice }}</div>

    <!-- ── свежесть данных ──────────────────────────────────────────────── -->
    <!--
      Видно сразу одно — когда данные обновлялись. Источники по отдельности,
      аккаунт и ссылка на настройки — по нажатию на строку (D-065).
    -->
    <section class="card home-sync">
      <div class="home-sync__top">
        <button
          type="button"
          class="home-sync__line"
          :aria-expanded="syncOpen"
          :aria-label="t('home.sync.more')"
          @click="syncOpen = !syncOpen"
        >
          <span
            class="home-sync__mark"
            :class="overallFresh ? 'home-sync__mark--ok' : 'home-sync__mark--warn'"
            aria-hidden="true"
          >
            {{ overallFresh ? '✓' : '!' }}
          </span>
          <span class="home-sync__text">
            <template v-if="home.freshness.isDemo">
              {{ t('home.sync.demo', { date: home.freshness.yazio.dataTo ? dayMonth(home.freshness.yazio.dataTo) : '—' }) }}
            </template>
            <template v-else-if="home.freshness.yazio.syncedAt">
              {{ t('home.sync.last', { when: when(home.freshness.yazio.syncedAt) }) }}
            </template>
            <template v-else>{{ t('home.sync.never') }}</template>
          </span>
          <span class="home-sync__caret" aria-hidden="true">{{ syncOpen ? '▴' : '▾' }}</span>
        </button>

        <button
          v-if="!home.freshness.isDemo"
          type="button"
          class="btn home-sync__run"
          :disabled="syncing"
          @click="runSync"
        >
          <span v-if="syncing" class="spinner" />
          <AppIcon v-else name="swap" :size="14" />
          {{ syncing ? t('home.sync.running') : t('sync.start') }}
        </button>
      </div>

      <p v-if="staleNote" class="tiny home-sync__stale">{{ staleNote }}</p>

      <div v-if="syncOpen" class="home-sync__sources">
        <p class="home-sync__source">
          <span class="chip" :class="yazioFresh ? 'chip--ok' : 'chip--warn'">
            {{ yazioFresh ? t('home.sync.fresh') : t('home.sync.stale') }}
          </span>
          <strong>YAZIO</strong>
          <span class="tiny">
            {{
              home.freshness.yazio.syncedAt
                ? t('home.sync.yazio.at', { when: when(home.freshness.yazio.syncedAt) })
                : t('home.sync.yazio.never')
            }}
            <template v-if="home.freshness.yazio.status === 'failed'"> · {{ t('home.sync.yazio.failed') }}</template>
            <template v-if="home.freshness.yazio.dataTo">
              · {{ t('home.sync.yazio.data', { date: dayMonth(home.freshness.yazio.dataTo) }) }}
            </template>
          </span>
        </p>

        <p class="home-sync__source">
          <span
            class="chip"
            :class="healthFresh === null ? 'chip--mute' : healthFresh ? 'chip--ok' : 'chip--warn'"
          >
            {{ healthFresh === false ? t('home.sync.stale') : t('home.sync.fresh') }}
          </span>
          <strong>Apple Health</strong>
          <span class="tiny">
            {{
              home.freshness.health.importedAt
                ? t('home.sync.health.at', { when: when(home.freshness.health.importedAt) })
                : t('home.sync.health.never')
            }}
            <template v-if="home.freshness.health.dataTo">
              · {{ t('home.sync.health.data', { date: dayMonth(home.freshness.health.dataTo) }) }}
            </template>
          </span>
        </p>

        <div class="home-sync__account">
          <span class="tiny">{{ t('home.sync.account') }}:</span>
          <strong class="account__name">{{ account.label || '—' }}</strong>
          <button class="btn btn--small" type="button" @click="startNaming">
            <AppIcon name="edit" :size="13" />
            {{ account.label ? t('overview.name.change') : t('overview.name.set') }}
          </button>
          <span class="tiny">
            <span class="mono email" :title="account.email">{{ account.email }}</span>
            · {{ t('overview.registered') }} {{ account.registrationDate || '—' }}
            · {{ account.storedDays }} {{ t('overview.storedDays') }}
          </span>
        </div>

        <div v-if="naming" class="home-sync__naming">
          <label class="field" style="margin: 0 0 0.4rem">
            <span>{{ t('overview.name') }}</span>
            <input
              v-model="draftName"
              type="text"
              maxlength="64"
              :placeholder="t('overview.name.hint')"
              @keydown.enter.prevent="saveName"
            />
          </label>
          <p class="tiny muted">{{ t('overview.name.note') }}</p>
          <div class="row" style="gap: 0.4rem">
            <button class="btn btn--primary btn--small" type="button" :disabled="saving" @click="saveName">
              <AppIcon name="check" :size="14" /> {{ t('common.save') }}
            </button>
            <button class="btn btn--small" type="button" @click="naming = false">{{ t('common.cancel') }}</button>
          </div>
        </div>

        <NuxtLink class="tiny" :to="`/accounts/${id}/sync`">{{ t('home.sync.settings') }} →</NuxtLink>
      </div>
    </section>

    <!-- ── энергетический баланс ────────────────────────────────────────── -->
    <section class="card home-balance">
      <div class="home-card__head">
        <h2>{{ t('home.balance.title') }}</h2>
        <span v-if="home.balance" class="tiny">{{ balanceDay }}</span>
      </div>

      <template v-if="home.balance">
        <div class="home-balance__main">
          <div class="home-balance__big">
            <p class="home-balance__number">
              <span class="home-balance__value mono">{{ signed(home.balance.balanceKcal) }}</span>
              <span class="home-balance__unit">{{ t('common.kcal') }}</span>
            </p>
            <span class="chip" :class="ZONE_TONE[home.balance.zone]">
              {{ t(`home.zone.${home.balance.zone}`) }}
            </span>
          </div>

          <dl class="home-balance__parts">
            <div class="home-balance__part">
              <dt><span aria-hidden="true">🔥</span> {{ t('home.balance.burned') }}</dt>
              <dd class="home-balance__kcal mono">{{ num(home.balance.burnedKcal) }} {{ t('common.kcal') }}</dd>
              <dd class="tiny">{{ t('home.balance.burned.note') }}</dd>
            </div>
            <div class="home-balance__part">
              <dt><span aria-hidden="true">🍽️</span> {{ t('home.balance.eaten') }}</dt>
              <dd class="home-balance__kcal mono">{{ num(home.balance.eatenKcal) }} {{ t('common.kcal') }}</dd>
              <dd class="tiny">{{ t('home.balance.eaten.note') }}</dd>
            </div>
          </dl>
        </div>

        <!-- шкала — картинка к числу, а не замена ему: само число стоит выше -->
        <div class="home-scale" aria-hidden="true">
          <div class="home-scale__track">
            <span
              v-for="zone in scaleZones"
              :key="zone.key"
              class="home-scale__zone"
              :class="`home-scale__zone--${zone.key}`"
              :style="{ left: `${zone.left}%`, width: `${zone.width}%` }"
            />
            <span class="home-scale__marker" :style="{ left: `${scalePos(home.balance.balanceKcal)}%` }" />
          </div>
          <div class="home-scale__ticks">
            <span v-for="tick in SCALE_TICKS" :key="tick" :style="{ left: `${scalePos(tick)}%` }">
              {{ signed(tick) }}
            </span>
          </div>
        </div>

        <p class="tiny home-balance__goal">
          {{ t('home.balance.goal', { low: DEFICIT_CORRIDOR[0], high: DEFICIT_CORRIDOR[1] }) }}
        </p>
        <p v-for="note in balanceNotes" :key="note" class="tiny home-balance__note">{{ note }}</p>
      </template>

      <p v-else class="muted">{{ t('home.balance.none', { days: HOME_BALANCE_WINDOW_DAYS }) }}</p>
    </section>

    <div class="home-grid">
      <!-- ── последние дни ──────────────────────────────────────────────── -->
      <section class="card home-period">
        <div class="home-card__head">
          <h2>{{ periodTitle }}</h2>
          <span class="tiny">{{ t('home.period.avg') }}</span>
        </div>

        <div class="tabs home-period__tabs">
          <button
            v-for="days in PRESETS"
            :key="days"
            type="button"
            class="tab home-period__preset"
            :class="{ 'tab--on': !custom && preset === days }"
            @click="choosePreset(days)"
          >
            {{ t('home.period.preset', { days }) }}
          </button>
          <button
            type="button"
            class="tab home-period__preset"
            :class="{ 'tab--on': custom }"
            @click="custom = true"
          >
            {{ t('home.period.custom') }}
          </button>
        </div>

        <div v-if="custom" class="filters home-period__dates">
          <label class="filter">
            <span>{{ t('common.from') }}</span>
            <DateField v-model="from" no-future />
          </label>
          <label class="filter">
            <span>{{ t('common.to') }}</span>
            <DateField v-model="to" no-future />
          </label>
          <button
            class="btn btn--small btn--primary"
            type="button"
            :disabled="loadingSummary || !from || !to || from > to"
            @click="loadSummary()"
          >
            <span v-if="loadingSummary" class="spinner" />
            {{ t('common.apply') }}
          </button>
        </div>

        <template v-if="summary && hasPeriodData">
          <ul class="home-period__rows">
            <li v-for="row in periodRows" :key="row.key" class="home-period__row">
              <span class="home-period__mark" aria-hidden="true">{{ row.mark }}</span>
              <span class="home-period__label">
                {{ row.label }}
                <span class="tiny">{{ row.note }}</span>
              </span>
              <span class="home-period__value mono">{{ row.value }}</span>
            </li>
          </ul>

          <p class="home-period__verdict">
            <template v-if="periodState && periodZone">
              <span class="chip" :class="ZONE_TONE[periodZone]">{{ t(`balance.${periodState}`) }}</span>
              <span>{{ t(`home.period.${periodState}`, { value: num(Math.abs(summary.balance.avg ?? 0)) }) }}</span>
            </template>
            <span v-else class="muted">{{ t('home.period.noBalance') }}</span>
          </p>

          <PeriodBars :series="summary.series" :today="home.today" />
        </template>

        <p v-else-if="summary" class="muted">
          {{ t('home.noData') }}
          <NuxtLink :to="`/accounts/${id}/sync`">{{ t('nav.sync') }}</NuxtLink>
        </p>
        <p v-else class="muted"><span class="spinner" /> {{ t('common.loading') }}</p>
      </section>

      <!-- ── тренировки недели ──────────────────────────────────────────── -->
      <section class="card home-week">
        <div class="home-card__head">
          <h2>{{ t('home.week.title') }}</h2>
          <span class="tiny">
            {{ t('home.week.range', { from: dayMonth(home.week.from), to: dayMonth(home.week.to) }) }}
          </span>
        </div>

        <template v-if="home.week.workouts !== null">
          <div class="home-week__goal">
            <p class="home-week__line">
              <span><span aria-hidden="true">🏋️</span> {{ t('home.week.strength') }}</span>
              <span class="mono">
                {{ t('home.week.of', { value: home.week.strength.count ?? 0, goal: home.week.strength.goal }) }}
              </span>
            </p>
            <div class="progress">
              <div
                class="progress__fill"
                :class="{ 'progress__fill--ok': (home.week.strength.count ?? 0) >= home.week.strength.goal }"
                :style="{ width: share(home.week.strength.count, home.week.strength.goal) }"
              />
            </div>
          </div>

          <div class="home-week__goal">
            <p class="home-week__line">
              <span><span aria-hidden="true">🏃</span> {{ t('home.week.cardio') }}</span>
              <span class="mono">
                {{ t('home.week.ofMin', { value: home.week.cardio.minutes ?? 0, goal: home.week.cardio.goal }) }}
              </span>
            </p>
            <div class="progress">
              <div
                class="progress__fill"
                :class="{ 'progress__fill--ok': (home.week.cardio.minutes ?? 0) >= home.week.cardio.goal }"
                :style="{ width: share(home.week.cardio.minutes, home.week.cardio.goal) }"
              />
            </div>
          </div>

          <dl class="home-week__facts">
            <div>
              <dt><span aria-hidden="true">⏱️</span> {{ t('home.week.time') }}</dt>
              <dd class="mono">{{ duration(home.week.minutes) }}</dd>
            </div>
            <div>
              <dt><span aria-hidden="true">🔥</span> {{ t('home.week.energy') }}</dt>
              <dd class="mono">{{ num(home.week.energyKcal) }} {{ t('common.kcal') }}</dd>
            </div>
          </dl>

          <p v-if="weekDone" class="home-week__verdict home-week__verdict--done">
            <span aria-hidden="true">🏆</span> {{ t('home.week.done') }}
          </p>
          <p v-else class="home-week__verdict">
            {{
              t('home.week.left', {
                strength: Math.max(0, home.week.strength.goal - (home.week.strength.count ?? 0)),
                minutes: Math.max(0, home.week.cardio.goal - (home.week.cardio.minutes ?? 0)),
              })
            }}
          </p>

          <p v-if="home.week.knownTo && home.week.knownTo < home.today" class="tiny">
            {{ t('home.week.partial', { date: dayMonth(home.week.knownTo) }) }}
          </p>
        </template>

        <p v-else class="muted">
          {{
            home.week.knownTo
              ? t('home.week.unknown', { date: dayMonth(home.week.knownTo) })
              : t('home.week.never')
          }}
        </p>

        <p class="tiny">
          {{ t('home.week.goal', { strength: home.week.strength.goal, cardio: home.week.cardio.goal }) }}
        </p>
      </section>

      <!-- ── питание сегодня ────────────────────────────────────────────── -->
      <section class="card home-food">
        <div class="home-card__head">
          <h2>{{ t('home.food.title') }}</h2>
        </div>

        <template v-if="home.food.entries > 0">
          <p class="home-food__total">
            <span class="home-food__eaten mono">{{ num(home.food.eaten.energyKcal) }}</span>
            <span class="muted">
              {{
                home.food.targets.energyKcal !== null
                  ? t('home.food.of', { goal: num(home.food.targets.energyKcal) })
                  : t('common.kcal')
              }}
            </span>
          </p>
          <div class="progress">
            <div
              class="progress__fill"
              :style="{ width: share(home.food.eaten.energyKcal, home.food.targets.energyKcal) }"
            />
          </div>

          <div
            v-for="macro in FOOD_MACROS"
            :key="macro.key"
            class="home-food__macro"
            :class="`home-food__macro--${macro.key}`"
          >
            <p class="home-food__line">
              <span><span aria-hidden="true">{{ macro.mark }}</span> {{ capital(t(`macro.${macro.key}`)) }}</span>
              <span class="mono">
                {{
                  t('home.food.macro', {
                    value: num(home.food.eaten[macro.field]),
                    goal: num(home.food.targets[macro.field]),
                  })
                }}
                <span v-if="macro.key === 'protein' && proteinReached" class="home-food__check">✓</span>
              </span>
            </p>
            <div class="progress">
              <div
                class="progress__fill"
                :style="{ width: share(home.food.eaten[macro.field], home.food.targets[macro.field]) }"
              />
            </div>
          </div>

          <ul class="home-food__meals">
            <li v-for="meal in home.food.meals" :key="meal.meal" class="home-food__meal">
              <span class="home-food__meal-mark" aria-hidden="true">{{ MEAL_MARKS[meal.meal] ?? '🍴' }}</span>
              <span>{{ mealTitle(meal.meal) }}</span>
              <span class="mono tiny">{{ num(meal.energyKcal) }} {{ t('common.kcal') }}</span>
            </li>
          </ul>

          <p v-if="home.food.energyBasis" class="tiny">
            {{ t('home.food.goal', { planner: t('nav.planner'), basis: message(home.food.energyBasis) }) }}
          </p>
        </template>

        <template v-else>
          <p class="muted">{{ t('home.food.empty') }}</p>
          <p class="tiny">
            {{
              home.food.targets.energyKcal !== null
                ? t('home.food.target', { goal: num(home.food.targets.energyKcal) })
                : t('home.food.noTarget')
            }}
          </p>
        </template>
      </section>

      <!-- ── анализ словами ─────────────────────────────────────────────── -->
      <section class="card home-analysis">
        <div class="home-card__head">
          <h2>{{ t('home.analysis.title') }}</h2>
          <span class="tiny">{{ periodTitle }}</span>
        </div>

        <template v-if="summary">
          <ul class="home-analysis__lines">
            <li
              v-for="line in summary.analysis"
              :key="line.key"
              class="home-analysis__line"
              :class="`home-analysis__line--${line.tone}`"
            >
              {{ message(line.text) }}
            </li>
          </ul>

          <details class="home-analysis__more">
            <summary>{{ t('home.analysis.more') }}</summary>
            <ul class="home-analysis__basis-list">
              <li v-for="line in summary.analysis" :key="line.key" class="home-analysis__basis">
                {{ message(line.basis) }}
              </li>
            </ul>
          </details>
        </template>
        <p v-else class="muted"><span class="spinner" /> {{ t('common.loading') }}</p>
      </section>
    </div>

    <!-- ── разделы: в самом конце и свёрнуты ────────────────────────────── -->
    <details class="card home-sections">
      <summary>
        <AppIcon name="info" :size="16" />
        <span class="home-sections__title">{{ t('home.sections') }}</span>
        <span class="tiny">{{ t('home.sections.lede') }}</span>
      </summary>

      <div class="home-sections__grid">
        <NuxtLink
          v-for="section in SECTIONS"
          :key="section.to"
          :to="`/accounts/${id}${section.to}`"
          class="home-sections__link"
        >
          <span class="home-sections__head">
            <AppIcon :name="section.icon" :size="15" />
            <strong>{{ t(section.key) }}</strong>
          </span>
          <span class="tiny muted">{{ t(section.note) }}</span>
        </NuxtLink>
      </div>
    </details>
  </div>

  <div v-else-if="error" class="alert alert--bad">{{ error }}</div>
  <p v-else class="muted"><span class="spinner" /> {{ t('common.loading') }}</p>
</template>

<style scoped>
.home {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}
/* соседние карточки разводит `gap`, а не общее правило `.card + .card` */
.home > .card,
.home-grid > .card {
  margin-top: 0;
  min-width: 0;
}
.home > .alert {
  margin: 0;
}

.home-card__head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.15rem 0.75rem;
  margin-bottom: 0.7rem;
}
.home-card__head h2 {
  margin: 0;
}

/* ── приветствие ─────────────────────────────────────────────────────────── */
.home-hello {
  display: flex;
  align-items: center;
  gap: 0.85rem;
  margin-top: 0.25rem;
}
.home-hello__avatar {
  flex: none;
  display: grid;
  place-items: center;
  width: 3.1rem;
  height: 3.1rem;
  border-radius: 50%;
  background: var(--accent-bg);
  color: var(--accent-ink);
  font-size: 1.3rem;
  font-weight: 650;
}
.home-hello__text {
  min-width: 0;
}
.home-hello h1 {
  margin: 0;
  overflow-wrap: anywhere;
}
.home-hello__date {
  margin: 0.15rem 0 0;
  color: var(--ink-2);
}

/* ── свежесть данных ─────────────────────────────────────────────────────── */
.home-sync {
  padding-block: 0.7rem;
}
.home-sync__top {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem 0.75rem;
}
.home-sync__line {
  flex: 1 1 15rem;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 0.6rem;
  padding: 0.2rem 0;
  border: 0;
  background: none;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.home-sync__mark {
  flex: none;
  display: grid;
  place-items: center;
  width: 1.7rem;
  height: 1.7rem;
  border-radius: 50%;
  font-size: 0.85rem;
  font-weight: 700;
}
.home-sync__mark--ok {
  background: var(--ok-bg);
  color: var(--ok-ink);
}
.home-sync__mark--warn {
  background: var(--note-bg);
  color: var(--note-ink);
}
.home-sync__text {
  min-width: 0;
}
.home-sync__caret {
  flex: none;
  color: var(--ink-3);
  font-size: 0.75rem;
}
.home-sync__run {
  flex: none;
}
.home-sync__stale {
  margin: 0.4rem 0 0;
}
.home-sync__sources {
  display: grid;
  gap: 0.55rem;
  margin-top: 0.7rem;
  padding-top: 0.7rem;
  border-top: 1px solid var(--line-soft);
}
.home-sync__source,
.home-sync__account {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.3rem 0.5rem;
  margin: 0;
}
.home-sync__naming {
  padding: 0.7rem;
  border-radius: var(--radius-sm);
  background: var(--sunk);
}
/* почта — служебная строка: мелко, в одну строку и с многоточием (D-053) */
.email {
  display: inline-block;
  max-width: min(100%, 18rem);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  vertical-align: bottom;
}

/* ── баланс ──────────────────────────────────────────────────────────────── */
.home-balance__main {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1.25fr);
  align-items: center;
  gap: 1rem 1.5rem;
}
.home-balance__big {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
.home-balance__number {
  margin: 0;
  line-height: 1;
}
.home-balance__value {
  font-size: 2.7rem;
  font-weight: 650;
  letter-spacing: -0.04em;
}
.home-balance__unit {
  margin-left: 0.25rem;
  color: var(--ink-2);
  font-size: 1.05rem;
}
.home-balance__parts {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.75rem;
  margin: 0;
}
.home-balance__part {
  min-width: 0;
  padding-left: 0.8rem;
  border-left: 1px solid var(--line-soft);
}
.home-balance__part dt {
  font-size: 0.84rem;
  color: var(--ink-2);
}
.home-balance__part dd {
  margin: 0;
}
.home-balance__kcal {
  font-size: 1.3rem;
  font-weight: 600;
  white-space: nowrap;
}
.home-balance__goal {
  margin: 0.35rem 0 0;
}
.home-balance__note {
  margin: 0.25rem 0 0;
}

.home-scale {
  margin: 1.2rem 0.55rem 0;
}
.home-scale__track {
  position: relative;
  height: 0.6rem;
  border-radius: 999px;
  background: var(--sunk);
}
.home-scale__zone {
  position: absolute;
  top: 0;
  bottom: 0;
}
.home-scale__zone--deep {
  border-radius: 999px 0 0 999px;
  background: color-mix(in oklab, var(--accent-2) 45%, var(--sunk));
}
.home-scale__zone--target {
  background: var(--ok);
}
.home-scale__zone--small {
  background: color-mix(in oklab, var(--ok) 35%, var(--sunk));
}
.home-scale__zone--even {
  background: color-mix(in oklab, var(--accent) 30%, var(--sunk));
}
.home-scale__zone--surplus {
  border-radius: 0 999px 999px 0;
  background: color-mix(in oklab, var(--bad) 45%, var(--sunk));
}
.home-scale__marker {
  position: absolute;
  top: 50%;
  width: 1.1rem;
  height: 1.1rem;
  border: 3px solid var(--ink);
  border-radius: 50%;
  background: var(--surface);
  box-shadow: var(--shadow-lift);
  transform: translate(-50%, -50%);
}
.home-scale__ticks {
  position: relative;
  height: 1.1rem;
  margin-top: 0.4rem;
  font-family: var(--font-mono);
  font-size: 0.7rem;
  color: var(--ink-3);
}
.home-scale__ticks span {
  position: absolute;
  white-space: nowrap;
  transform: translateX(-50%);
}
.home-scale__ticks span:first-child {
  transform: none;
}
.home-scale__ticks span:last-child {
  transform: translateX(-100%);
}

/* ── сетка карточек ──────────────────────────────────────────────────────── */
.home-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(21rem, 100%), 1fr));
  gap: 1rem;
  /* не тянуть карточку до высоты соседа: честное «данных нет» — короткая карточка,
     а растянутая до соседней выглядит пустой коробкой */
  align-items: start;
}

/* ── последние дни ───────────────────────────────────────────────────────── */
.home-period__tabs {
  margin-bottom: 0.7rem;
  /* четыре кнопки помещаются в строку и на 360 пикселях, если не раздувать отступы */
  flex-wrap: nowrap;
}
.home-period__tabs .tab {
  padding: 0 0.6rem;
}
.home-period__dates {
  margin-bottom: 0.7rem;
}
.home-period__rows {
  margin: 0;
  padding: 0;
  list-style: none;
}
/* сетка с явными долями, а не флекс: длинная подпись не должна наезжать на число */
.home-period__row {
  display: grid;
  grid-template-columns: 1.5rem minmax(0, 1fr) auto;
  align-items: center;
  gap: 0.55rem;
  padding: 0.45rem 0;
  border-bottom: 1px solid var(--line-soft);
}
.home-period__row:last-child {
  border-bottom: 0;
}
.home-period__mark {
  text-align: center;
}
.home-period__label {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.home-period__value {
  font-weight: 600;
  text-align: right;
  white-space: nowrap;
}
.home-period__verdict {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.4rem;
  margin: 0.7rem 0 0;
  font-size: 0.88rem;
}

/* ── тренировки ──────────────────────────────────────────────────────────── */
.home-week__goal {
  margin-bottom: 0.85rem;
}
.home-week__line,
.home-food__line {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.6rem;
  margin: 0 0 0.3rem;
}
.home-week__facts {
  display: grid;
  gap: 0.35rem;
  margin: 1rem 0 0.8rem;
}
.home-week__facts div {
  display: flex;
  justify-content: space-between;
  gap: 0.6rem;
}
.home-week__facts dt {
  color: var(--ink-2);
}
.home-week__facts dd {
  margin: 0;
  font-weight: 600;
  white-space: nowrap;
}
.home-week__verdict {
  margin: 0 0 0.5rem;
  padding: 0.55rem 0.75rem;
  border-radius: var(--radius-sm);
  background: var(--sunk);
  font-size: 0.88rem;
}
.home-week__verdict--done {
  background: var(--ok-bg);
  font-weight: 600;
}

/* ── питание сегодня ─────────────────────────────────────────────────────── */
.home-food__total {
  margin: 0 0 0.45rem;
}
.home-food__eaten {
  margin-right: 0.3rem;
  font-size: 1.9rem;
  font-weight: 650;
  letter-spacing: -0.03em;
}
.home-food__macro {
  margin-top: 0.75rem;
}
/* цвет макроса — тот же, что в строке КБЖУ по всему сервису (D-035) */
.home-food__macro--protein .progress__fill {
  background: var(--accent);
}
.home-food__macro--fat .progress__fill {
  background: var(--accent-2);
}
.home-food__macro--carbs .progress__fill {
  background: var(--accent-3);
}
.home-food__check {
  margin-left: 0.2rem;
  color: var(--ok-ink);
  font-weight: 700;
}
.home-food__meals {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(5.5rem, 100%), 1fr));
  gap: 0.5rem;
  margin: 0.95rem 0 0.6rem;
  padding: 0;
  list-style: none;
}
.home-food__meal {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.15rem;
  padding: 0.5rem 0.3rem;
  border-radius: var(--radius-sm);
  background: var(--sunk);
  font-size: 0.82rem;
  text-align: center;
}
.home-food__meal-mark {
  font-size: 1.3rem;
  line-height: 1.2;
}

/* ── анализ ──────────────────────────────────────────────────────────────── */
.home-analysis__lines {
  display: grid;
  gap: 0.5rem;
  margin: 0;
  padding: 0;
  list-style: none;
}
/* вид вывода различает полоска слева, а не цвет текста (D-032) */
.home-analysis__line {
  padding: 0.55rem 0.75rem;
  border-left: 3px solid var(--ink-3);
  border-radius: var(--radius-sm);
  background: var(--sunk);
  font-size: 0.9rem;
}
.home-analysis__line--ok {
  border-left-color: var(--ok);
}
.home-analysis__line--info {
  border-left-color: var(--accent);
}
.home-analysis__line--warn {
  border-left-color: var(--accent-2);
}
.home-analysis__line--mute {
  color: var(--ink-2);
}
.home-analysis__more {
  margin-top: 0.75rem;
}
.home-analysis__more > summary {
  cursor: pointer;
  color: var(--accent-ink);
  font-size: 0.88rem;
  font-weight: 550;
}
.home-analysis__basis-list {
  display: grid;
  gap: 0.4rem;
  margin: 0.55rem 0 0;
  padding-left: 1.1rem;
  font-size: 0.82rem;
  color: var(--ink-2);
}

/* ── разделы ─────────────────────────────────────────────────────────────── */
.home-sections > summary {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.2rem 0.5rem;
  cursor: pointer;
  list-style: none;
}
.home-sections > summary::-webkit-details-marker {
  display: none;
}
.home-sections > summary::after {
  content: '▾';
  margin-left: auto;
  color: var(--ink-3);
}
.home-sections[open] > summary::after {
  content: '▴';
}
.home-sections__title {
  font-size: 1.05rem;
  font-weight: 620;
  letter-spacing: -0.02em;
}
.home-sections__grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(17rem, 100%), 1fr));
  gap: 0.6rem;
  margin-top: 0.8rem;
}
.home-sections__link {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  padding: 0.75rem 0.85rem;
  border: 1px solid var(--line-soft);
  border-radius: var(--radius-sm);
  background: var(--sunk);
  color: inherit;
  text-decoration: none;
  transition: border-color 0.15s, background 0.15s;
}
.home-sections__link:hover {
  border-color: color-mix(in oklab, var(--accent) 45%, var(--line));
  background: var(--accent-bg);
}
.home-sections__head {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  color: var(--ink);
}

@media (max-width: 40rem) {
  .home-balance__main {
    grid-template-columns: minmax(0, 1fr);
  }
  .home-balance__value {
    font-size: 2.3rem;
  }
}
</style>
