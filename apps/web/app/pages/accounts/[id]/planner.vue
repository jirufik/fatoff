<script setup lang="ts">
import {
  MEALS,
  MEAL_TITLES,
  TRAINING_MODES,
  TRAINING_MODE_NOTES,
  TRAINING_MODE_TITLES,
  WORKOUT_TITLES,
  unitLabel,
  workoutTitle,
  type AccountDto,
  type AlgorithmSettingsDto,
  type GenerateRequest,
  type GeneratedPlanDto,
  type ManualWorkoutDto,
  type MealKey,
  type PinnedDto,
  type PlanDayDto,
  type PoolItemDto,
  type SettingGroupSpec,
  type SettingSpec,
  type TargetSettingsDto,
  type TargetsDto,
  type TemplateDto,
  type TrainingMode,
} from '@fatoff/contracts'

/**
 * Режим: нормы, конструктор, готовый план.
 *
 * Порядок на странице повторяет порядок работы: сначала видно, к чему целимся,
 * потом собираем, потом смотрим результат. Шаблоны живут внутри конструктора
 * строкой «начать с готового», а не отдельной плитой между сборкой и её итогом.
 *
 * Готовый план правится руками: блюдо можно заменить, изменить граммовку или
 * закрепить. Пересчитывает при этом сервер — второй копии арифметики в браузере
 * нет намеренно.
 */
const api = useApi()
const { t, message, pick, locale } = useI18n()
const route = useRoute()
const id = route.params.id as string

/** На что опирается расчёт норм — ссылками, а не на слово. */
const SOURCES = [
  { key: 'source.who', url: 'https://www.ncbi.nlm.nih.gov/books/NBK566046/' },
  { key: 'source.issn', url: 'https://link.springer.com/article/10.1186/s12970-017-0177-8' },
  { key: 'source.ioc', url: 'https://pubmed.ncbi.nlm.nih.gov/29773536/' },
  { key: 'source.mifflin', url: 'https://pubmed.ncbi.nlm.nih.gov/2305711/' },
  { key: 'source.proteinPerMeal', url: 'https://www.tandfonline.com/doi/full/10.1186/s12970-018-0215-1' },
  { key: 'source.lossRate', url: 'https://pubmed.ncbi.nlm.nih.gov/21558571/' },
  { key: 'source.fiber', url: 'https://pubmed.ncbi.nlm.nih.gov/26514720/' },
]

interface Schema {
  groups: SettingGroupSpec[]
  settings: SettingSpec[]
  defaults: { targets: TargetSettingsDto; algorithm: AlgorithmSettingsDto }
}

const account = ref<AccountDto | null>(null)
const schema = ref<Schema | null>(null)
const targets = ref<TargetsDto | null>(null)
const plan = ref<GeneratedPlanDto | null>(null)
const templates = ref<TemplateDto[]>([])
const pool = ref<PoolItemDto[]>([])

const error = ref('')
const notice = ref('')
const busy = ref(false)

// ── конструктор ───────────────────────────────────────────────────────────
const from = ref(nextMonday())
const to = ref(addDays(nextMonday(), 6))
const meals = ref<MealKey[]>([...MEALS])
const mode = ref<TrainingMode>('current')
const manual = ref<ManualWorkoutDto[]>([])
const sessionsPerWeek = ref<number | null>(null)
const values = ref<Record<string, number | boolean | null>>({})

// из чего собирать
const poolFrom = ref('')
const poolTo = ref('')
const poolKeys = ref<string[]>([])
const poolSearch = ref('')
const poolOpen = ref(false)

// закреплённое человеком
const pinned = ref<PinnedDto[]>([])

const showAdvanced = ref(false)
const showTemplateForm = ref(false)
const openGroups = ref<Record<string, boolean>>({})
const openDay = ref<string | null>(null)
const planName = ref('')
const planTags = ref<string[]>([])
/** Заведённые метки аккаунта: при сохранении их предлагают, а не набирают. */
const knownTags = ref<Array<{ tag: string; count: number }>>([])
const templateName = ref('')
const templateNote = ref('')

/** Замена блюда: какая позиция сейчас меняется и что ищем. */
const swapping = ref<{ date: string; meal: MealKey; index: number } | null>(null)
const swapSearch = ref('')

/** Сколько занятий поставит генератор сам — чтобы «решает генератор» не было котом в мешке. */
const suggestedSessions = computed(() => (mode.value === 'who' ? 5 : 7))

const volumeHint = computed(() => {
  if (sessionsPerWeek.value !== null) {
    return t('planner.training.hint.exact', { count: sessionsPerWeek.value })
  }
  return t(`planner.training.hint.${mode.value === 'manual' ? 'current' : mode.value}`)
})

const basicSettings = computed(() => (schema.value?.settings ?? []).filter((s) => !s.advanced))

const groupsWithSettings = computed(() =>
  (schema.value?.groups ?? []).map((group) => ({
    group,
    settings: (schema.value?.settings ?? []).filter((s) => s.group === group.key),
  })),
)

const poolFiltered = computed(() => {
  const query = poolSearch.value.trim().toLowerCase()
  const list = query ? pool.value.filter((item) => item.name.toLowerCase().includes(query)) : pool.value
  return list.slice(0, 300)
})

const swapOptions = computed(() => {
  const at = swapping.value
  if (!at) return []
  const query = swapSearch.value.trim().toLowerCase()
  return pool.value
    .filter((item) => item.meals.includes(at.meal))
    .filter((item) => !query || item.name.toLowerCase().includes(query))
    .slice(0, 60)
})

/** Плоские значения по ключам `targets.x` / `algorithm.y.z` собираются в объект запроса. */
function nested(): Pick<GenerateRequest, 'targets' | 'algorithm'> {
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(values.value)) {
    if (value === undefined) continue
    const path = key.split('.')
    let current = result
    for (const part of path.slice(0, -1)) {
      if (typeof current[part] !== 'object' || current[part] === null) current[part] = {}
      current = current[part] as Record<string, unknown>
    }
    current[path[path.length - 1]] = value
  }
  return result as Pick<GenerateRequest, 'targets' | 'algorithm'>
}

function poolFilter(): GenerateRequest['pool'] {
  const filter: NonNullable<GenerateRequest['pool']> = {}
  if (poolFrom.value) filter.from = poolFrom.value
  if (poolTo.value) filter.to = poolTo.value
  if (poolKeys.value.length > 0) filter.keys = [...poolKeys.value]
  return Object.keys(filter).length > 0 ? filter : undefined
}

function request(seed?: number): GenerateRequest {
  const settings = nested()
  return {
    from: from.value,
    to: to.value,
    meals: meals.value,
    training: {
      mode: mode.value,
      manual: mode.value === 'manual' ? manual.value : undefined,
      sessionsPerWeek: sessionsPerWeek.value ?? undefined,
    },
    targets: settings.targets,
    algorithm: settings.algorithm,
    pool: poolFilter(),
    pinned: pinned.value.length > 0 ? pinned.value : undefined,
    seed,
  }
}

// ── загрузка ──────────────────────────────────────────────────────────────
async function loadTargets(): Promise<void> {
  try {
    const rate = values.value['targets.lossRatePctPerWeek']
    const query = typeof rate === 'number' ? `?rate=${rate}` : ''
    targets.value = await api.get<TargetsDto>(`/accounts/${id}/planner/targets${query}`)
  } catch (caught) {
    error.value = errorMessage(caught)
  }
}

async function loadPool(): Promise<void> {
  const query = new URLSearchParams()
  if (poolFrom.value) query.set('from', poolFrom.value)
  if (poolTo.value) query.set('to', poolTo.value)
  pool.value = await api.get<PoolItemDto[]>(
    `/accounts/${id}/planner/pool${query.size ? `?${query}` : ''}`,
  )
  // отмеченные блюда, выпавшие из нового периода, снимаем: их больше нет
  const alive = new Set(pool.value.map((item) => item.key))
  poolKeys.value = poolKeys.value.filter((key) => alive.has(key))
}

async function loadTemplates(): Promise<void> {
  templates.value = await api.get<TemplateDto[]>(`/accounts/${id}/planner/templates`)
}

async function generate(fresh = false): Promise<void> {
  busy.value = true
  error.value = ''
  notice.value = ''
  try {
    const seed = fresh ? Math.floor(Math.random() * 2 ** 31) : (plan.value?.seed ?? undefined)
    plan.value = await api.post<GeneratedPlanDto>(`/accounts/${id}/planner/generate`, request(seed))
    openDay.value = plan.value.days[0]?.date ?? null
    planName.value = `Режим ${plan.value.from} — ${plan.value.to}`
  } catch (caught) {
    error.value = errorMessage(caught)
  } finally {
    busy.value = false
  }
}

// ── правка готового плана ─────────────────────────────────────────────────
async function recost(date: string): Promise<void> {
  const day = plan.value?.days.find((item) => item.date === date)
  if (!day) return

  const settings = nested()
  try {
    const updated = await api.post<PlanDayDto>(`/accounts/${id}/planner/recost`, {
      date,
      workoutKcal: day.workoutKcal,
      meals: day.meals.map((meal) => ({
        meal: meal.meal,
        items: meal.items.map((item) => ({ key: item.key, amount: item.amount })),
      })),
      targets: settings.targets,
      algorithm: settings.algorithm,
      pool: poolFilter(),
    })

    // тренировки пересчёт не трогает — они не зависят от того, что в тарелке
    Object.assign(day, { ...updated, workouts: day.workouts, workoutKcal: day.workoutKcal })
    refreshSummary()
  } catch (caught) {
    error.value = errorMessage(caught)
  }
}

function replaceItem(key: string): void {
  const at = swapping.value
  if (!at) return

  const day = plan.value?.days.find((item) => item.date === at.date)
  const meal = day?.meals.find((item) => item.meal === at.meal)
  const replacement = pool.value.find((item) => item.key === key)
  if (!day || !meal || !replacement) return

  const was = meal.items[at.index]
  meal.items[at.index] = {
    key: replacement.key,
    pinned: was?.pinned ?? false,
    name: replacement.name,
    amount: replacement.typicalAmount,
    unit: replacement.kind === 'recipe' ? 'portion' : (replacement.baseUnit ?? 'g'),
    serving: replacement.serving,
    servings: null,
    energyKcal: Math.round(replacement.per.energyKcal * replacement.typicalAmount),
    proteinG: 0,
    carbsG: 0,
    fatG: 0,
    fiberG: 0,
  }

  swapping.value = null
  swapSearch.value = ''
  void recost(at.date)
}

function setAmount(date: string, meal: MealKey, index: number, raw: string): void {
  const amount = Number(raw)
  if (!Number.isFinite(amount) || amount <= 0) return

  const day = plan.value?.days.find((item) => item.date === date)
  const target = day?.meals.find((item) => item.meal === meal)
  if (!target?.items[index]) return

  target.items[index].amount = amount
  void recost(date)
}

// ── правка тренировок ─────────────────────────────────────────────────────
/** Пересчёт затрат по цене минуты и обновление дня целиком. */
function applyWorkouts(day: PlanDayDto): void {
  for (const workout of day.workouts) {
    const type = plan.value?.workoutTypes.find((entry) => entry.type === workout.type)
    if (!type) continue
    workout.group = type.group
    workout.energyKcal = Math.round(workout.durationMin * type.kcalPerMin)
  }
  day.workoutKcal = day.workouts.reduce((sum, workout) => sum + workout.energyKcal, 0)
  refreshSummary()
  void recost(day.date)
}

function setWorkoutType(day: PlanDayDto, index: number, type: string): void {
  const workout = day.workouts[index]
  if (!workout) return
  workout.type = type
  applyWorkouts(day)
}

function setWorkoutTime(day: PlanDayDto, index: number, raw: string): void {
  const minutes = Number(raw)
  if (!Number.isFinite(minutes) || minutes <= 0) return
  const workout = day.workouts[index]
  if (!workout) return
  workout.durationMin = Math.round(minutes)
  applyWorkouts(day)
}

function removeWorkout(day: PlanDayDto, index: number): void {
  day.workouts.splice(index, 1)
  applyWorkouts(day)
}

function addWorkout(day: PlanDayDto): void {
  const type = plan.value?.workoutTypes[0]
  if (!type) return
  day.workouts.push({
    type: type.type,
    group: type.group,
    durationMin: type.avgMin || 45,
    energyKcal: 0,
  })
  applyWorkouts(day)
}

/** Сводка считается по дням: после правки она обязана сойтись с тем, что видно. */
function refreshSummary(): void {
  const days = plan.value?.days
  if (!plan.value || !days || days.length === 0) return

  const avg = (pick: (day: PlanDayDto) => number | null | undefined): number =>
    Math.round((days.reduce((sum, day) => sum + (pick(day) ?? 0), 0) / days.length) * 10) / 10

  plan.value.summary = {
    days: days.length,
    avgEnergyKcal: Math.round(
      days.reduce((sum, day) => sum + (day.totals.energyKcal ?? 0), 0) / days.length,
    ),
    avgProteinG: avg((day) => day.totals.proteinG),
    avgCarbsG: avg((day) => day.totals.carbsG),
    avgFatG: avg((day) => day.totals.fatG),
    avgFiberG: avg((day) => day.totals.fiberG),
    workouts: days.reduce((sum, day) => sum + day.workouts.length, 0),
    trainingMinutes: days.reduce(
      (sum, day) => sum + day.workouts.reduce((inner, workout) => inner + workout.durationMin, 0),
      0,
    ),
    restDays: days.filter((day) => day.workouts.length === 0).length,
  }
}

/** Закрепление: блюдо переживёт следующую сборку и встанет в тот же приём. */
function togglePin(date: string, meal: MealKey, key: string, amount: number): void {
  const at = pinned.value.findIndex(
    (item) => item.date === date && item.meal === meal && item.key === key,
  )
  if (at >= 0) pinned.value.splice(at, 1)
  else pinned.value.push({ date, meal, key, amount })

  const day = plan.value?.days.find((item) => item.date === date)
  const item = day?.meals.find((entry) => entry.meal === meal)?.items.find((entry) => entry.key === key)
  if (item) item.pinned = at < 0
}

const isPinned = (date: string, meal: MealKey, key: string): boolean =>
  pinned.value.some((item) => item.date === date && item.meal === meal && item.key === key)

// ── планы и шаблоны ───────────────────────────────────────────────────────
async function loadKnownTags(): Promise<void> {
  try {
    knownTags.value = await api.get<Array<{ tag: string; count: number }>>(
      `/accounts/${id}/planner/plans/tags`,
    )
  } catch {
    // список меток — подсказка, а не условие сохранения: молча обходимся без неё
    knownTags.value = []
  }
}

async function savePlan(): Promise<void> {
  if (!plan.value) return
  busy.value = true
  try {
    await api.post(`/accounts/${id}/planner/plans`, {
      name: planName.value,
      tags: planTags.value,
      plan: plan.value,
    })
    planTags.value = []
    await loadKnownTags()
    notice.value = t('common.saved')
  } catch (caught) {
    error.value = errorMessage(caught)
  } finally {
    busy.value = false
  }
}

async function saveTemplate(): Promise<void> {
  busy.value = true
  try {
    const settings = nested()
    await api.post(`/accounts/${id}/planner/templates`, {
      name: templateName.value,
      description: templateNote.value,
      settings: {
        meals: meals.value,
        training: {
          mode: mode.value,
          manual: manual.value,
          sessionsPerWeek: sessionsPerWeek.value ?? undefined,
        },
        targets: settings.targets,
        algorithm: settings.algorithm,
      },
    })
    templateName.value = ''
    templateNote.value = ''
    showTemplateForm.value = false
    await loadTemplates()
    notice.value = t('common.saved')
  } catch (caught) {
    error.value = errorMessage(caught)
  } finally {
    busy.value = false
  }
}

async function removeTemplate(templateId: string): Promise<void> {
  await api.del(`/accounts/${id}/planner/templates/${templateId}`)
  await loadTemplates()
}

const applied = ref('')

/** Повторное нажатие снимает набор: иначе выбранное невозможно отменить. */
function toggleTemplate(template: TemplateDto): void {
  if (applied.value === template.id) {
    applied.value = ''
    resetValues()
    meals.value = [...MEALS]
    void loadTargets()
    return
  }
  applyTemplate(template)
}

/** Набор задаёт «как»: период остаётся тем, что выбран на странице. */
function applyTemplate(template: TemplateDto): void {
  const settings = template.settings
  if (settings.meals) meals.value = [...settings.meals]
  if (settings.training) {
    mode.value = settings.training.mode
    manual.value = settings.training.manual ? [...settings.training.manual] : []
    sessionsPerWeek.value = settings.training.sessionsPerWeek ?? null
  }

  resetValues()
  for (const spec of schema.value?.settings ?? []) {
    const path = spec.key.split('.')
    let current: unknown = settings
    for (const part of path) {
      if (typeof current !== 'object' || current === null) {
        current = undefined
        break
      }
      current = (current as Record<string, unknown>)[part]
    }
    if (current !== undefined && current !== null) values.value[spec.key] = current as number | boolean
  }

  applied.value = template.id
  void loadTargets()
}

function resetValues(): void {
  const next: Record<string, number | boolean | null> = {}
  for (const spec of schema.value?.settings ?? []) next[spec.key] = spec.default
  values.value = next
}

function period(days: number): void {
  const start = days === 1 ? today() : nextMonday()
  from.value = start
  to.value = addDays(start, days - 1)
}

function toggleMeal(meal: MealKey): void {
  meals.value = meals.value.includes(meal)
    ? meals.value.filter((item) => item !== meal)
    : ([...MEALS].filter((item) => item === meal || meals.value.includes(item)) as MealKey[])
}

function togglePoolKey(key: string): void {
  const at = poolKeys.value.indexOf(key)
  if (at >= 0) poolKeys.value.splice(at, 1)
  else poolKeys.value.push(key)
}

function addManual(): void {
  manual.value.push({ weekday: 1, type: 'Walking', durationMin: 45 })
}

/** Диалоги закрываются Escape: без этого мышь становится единственным выходом. */
function onEscape(event: KeyboardEvent): void {
  if (event.key !== 'Escape') return
  if (swapping.value) swapping.value = null
  else if (poolOpen.value) poolOpen.value = false
}

onMounted(() => window.addEventListener('keydown', onEscape))
onBeforeUnmount(() => window.removeEventListener('keydown', onEscape))

/** Пересчёт норм ждёт, пока перестанут крутить ползунки. */
let targetsTimer: ReturnType<typeof setTimeout> | null = null
watch(
  values,
  () => {
    if (targetsTimer) clearTimeout(targetsTimer)
    targetsTimer = setTimeout(() => void loadTargets(), 400)
  },
  { deep: true },
)

let poolTimer: ReturnType<typeof setTimeout> | null = null
watch([poolFrom, poolTo], () => {
  if (poolTimer) clearTimeout(poolTimer)
  poolTimer = setTimeout(() => void loadPool(), 400)
})

onMounted(async () => {
  try {
    ;[account.value, schema.value] = await Promise.all([
      api.get<AccountDto>(`/accounts/${id}`),
      api.get<Schema>(`/accounts/${id}/planner/settings`),
    ])
    resetValues()
    await Promise.all([loadTargets(), loadTemplates(), loadPool(), loadKnownTags()])

    // план, открытый из раздела «Планы», ждёт в хранилище вкладки
    const carried = sessionStorage.getItem('fatoff:open-plan')
    if (carried) {
      sessionStorage.removeItem('fatoff:open-plan')
      plan.value = JSON.parse(carried) as GeneratedPlanDto
      openDay.value = plan.value.days[0]?.date ?? null
      planName.value = `${plan.value.from} — ${plan.value.to}`
    }
  } catch (caught) {
    error.value = errorMessage(caught)
  }
})

// ── вспомогательное ───────────────────────────────────────────────────────
const unit = (value: string): string => unitLabel(locale.value, value)

const num = (value: number | null | undefined, digits = 0): string =>
  value === null || value === undefined
    ? '—'
    : value.toLocaleString('ru-RU', { maximumFractionDigits: digits })

const BALANCE_TONE: Record<string, string> = {
  deficit: 'chip--ok',
  even: 'chip--info',
  surplus: 'chip--warn',
}

const signedKcal = (value: number | null | undefined): string =>
  value === null || value === undefined ? '—' : `${value > 0 ? '+' : ''}${num(value)} ккал`

/** Русское число со словом; в английском форма одна на всё, кроме единицы. */
function notesLabel(count: number): string {
  const mod100 = count % 100
  const mod10 = count % 10
  if (mod100 < 11 || mod100 > 14) {
    if (mod10 === 1) return t('planner.day.notes', { count })
    if (mod10 >= 2 && mod10 <= 4) return t('planner.day.notes.few', { count })
  }
  return t('planner.day.notes.many', { count })
}

const signed = (value: number | null | undefined): string =>
  value === null || value === undefined ? '—' : `${value > 0 ? '+' : ''}${num(value, 1)}`

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

function addDays(date: string, days: number): string {
  const at = new Date(`${date}T00:00:00Z`)
  at.setUTCDate(at.getUTCDate() + days)
  return at.toISOString().slice(0, 10)
}

function nextMonday(): string {
  const at = new Date()
  const shift = (8 - (at.getUTCDay() || 7)) % 7 || 7
  at.setUTCDate(at.getUTCDate() + shift)
  return at.toISOString().slice(0, 10)
}
</script>

<template>
  <div>
    <PageHead :title="t('nav.planner')" :back="`/accounts/${id}`">
      {{ t('planner.lede') }}
    </PageHead>

    <div v-if="error" class="alert alert--bad">{{ error }}</div>
    <div v-if="notice" class="alert alert--ok">{{ notice }}</div>

    <!-- ── нормы ──────────────────────────────────────────────────────────── -->
    <section v-if="targets" class="card">
      <h2><AppIcon name="target" :size="16" /> {{ t('planner.targets') }}</h2>
      <p class="tiny muted">
        {{ t('planner.targets.lede') }}
      </p>

      <div class="table-wrap" style="margin-top: 0.6rem">
        <table class="data">
          <thead>
            <tr>
              <th>{{ t('planner.col.metric') }}</th>
              <th class="num">{{ t('planner.col.computed') }}</th>
              <th class="num">{{ t('planner.col.yazio') }}</th>
              <th class="num">{{ t('planner.col.diff') }}</th>
              <th>{{ t('planner.col.basis') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><span class="mark" aria-hidden="true">🔥</span> {{ t('planner.row.calories') }}</td>
              <td class="num"><strong>{{ num(targets.computed.energyKcal) }}</strong></td>
              <td class="num">{{ num(targets.yazio.energyKcal) }}</td>
              <td class="num">{{ signed(targets.diff.energyKcal) }}</td>
              <td class="tiny muted">{{ message(targets.basis.energy) }}</td>
            </tr>
            <tr>
              <td><span class="mark" aria-hidden="true">🥩</span> {{ t('planner.row.protein') }}</td>
              <td class="num"><strong>{{ num(targets.computed.proteinG) }}</strong></td>
              <td class="num">{{ num(targets.yazio.proteinG) }}</td>
              <td class="num">{{ signed(targets.diff.proteinG) }}</td>
              <td class="tiny muted">{{ message(targets.basis.protein) }}</td>
            </tr>
            <tr>
              <td><span class="mark" aria-hidden="true">🍞</span> {{ t('planner.row.carbs') }}</td>
              <td class="num"><strong>{{ num(targets.computed.carbsG) }}</strong></td>
              <td class="num">{{ num(targets.yazio.carbsG) }}</td>
              <td class="num">{{ signed(targets.diff.carbsG) }}</td>
              <td class="tiny muted">{{ message(targets.basis.carbs) }}</td>
            </tr>
            <tr>
              <td><span class="mark" aria-hidden="true">🧈</span> {{ t('planner.row.fat') }}</td>
              <td class="num"><strong>{{ num(targets.computed.fatG) }}</strong></td>
              <td class="num">{{ num(targets.yazio.fatG) }}</td>
              <td class="num">{{ signed(targets.diff.fatG) }}</td>
              <td class="tiny muted">{{ message(targets.basis.fat) }}</td>
            </tr>
            <tr>
              <td><span class="mark" aria-hidden="true">🥦</span> {{ t('planner.row.fiber') }}</td>
              <td class="num"><strong>{{ num(targets.computed.fiberG) }}</strong></td>
              <td class="num">{{ num(targets.yazio.fiberG) }}</td>
              <td class="num">{{ signed(targets.diff.fiberG) }}</td>
              <td class="tiny muted">{{ message(targets.basis.fiber) }}</td>
            </tr>
            <tr>
              <td><span class="mark" aria-hidden="true">🥩</span> {{ t('planner.row.proteinPerMeal') }}</td>
              <td class="num"><strong>{{ num(targets.proteinPerMealG) }}</strong></td>
              <td class="num">—</td>
              <td class="num">—</td>
              <td class="tiny muted">{{ message(targets.basis.proteinPerMeal) }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="stats" style="margin-top: 0.8rem">
        <div>
          <div class="stat__label">{{ t('planner.stat.expenditure') }}</div>
          <div class="stat__value">{{ num(targets.expenditure.totalKcal) }}</div>
          <div class="tiny muted">{{ message(targets.basis.basal) }}</div>
        </div>
        <div>
          <div class="stat__label">{{ t('planner.stat.deficit') }}</div>
          <div class="stat__value">{{ num(targets.deficitKcal) }}</div>
          <div class="tiny muted">{{ message(targets.basis.deficit) }}</div>
        </div>
        <div>
          <div class="stat__label">{{ t('planner.stat.body') }}</div>
          <div class="stat__value">
            {{ num(targets.profile.weightKg, 1) }} / {{ num(targets.profile.bodyFatPct, 1) }}% /
            {{ num(targets.profile.leanMassKg, 1) }}
          </div>
          <div class="tiny muted">{{ message(targets.basis.bodyFat) }}</div>
        </div>
        <div>
          <div class="stat__label">{{ t('planner.stat.ea') }}</div>
          <div class="stat__value">
            <span
              class="chip"
              :class="
                (targets.energyAvailability.current ?? 99) < targets.energyAvailability.threshold
                  ? 'chip--bad'
                  : 'chip--ok'
              "
            >
              {{ num(targets.energyAvailability.current, 1) }}
            </span>
            <span class="tiny muted">→ {{ num(targets.energyAvailability.atTarget, 1) }}</span>
          </div>
          <div class="tiny muted">{{ message(targets.basis.energyAvailability) }}</div>
        </div>
      </div>

      <div v-for="(warning, index) in targets.warnings" :key="index" class="alert alert--warn">
        {{ message(warning) }}
      </div>

      <p class="sources">
        <span class="tiny">{{ t('planner.sources') }}</span>
        <a v-for="source in SOURCES" :key="source.url" :href="source.url" target="_blank" rel="noopener noreferrer">
          {{ t(source.key) }}<AppIcon name="external" :size="10" />
        </a>
      </p>
    </section>

    <!-- ── конструктор ────────────────────────────────────────────────────── -->
    <section class="card">
      <h2><AppIcon name="sliders" :size="16" /> {{ t('planner.builder') }}</h2>

      <!-- наборы строкой: начать с готового, а не листать плиту между сборкой и итогом -->
      <p class="tiny muted starters__note">
        <strong>{{ t('planner.starters') }}</strong> {{ t('planner.starters.note') }}
      </p>
      <div class="starters">
        <span
          v-for="template in templates"
          :key="template.id"
          class="starter"
          :class="{ 'starter--on': applied === template.id }"
        >
          <button type="button" :title="template.description" @click="toggleTemplate(template)">
            <AppIcon name="bookmark" :size="12" />
            {{ pick(template.name) }}
          </button>
          <button
            v-if="!template.builtin"
            class="starter__x"
            type="button"
            :title="t('planner.template.delete')"
            @click="removeTemplate(template.id)"
          >
            ×
          </button>
        </span>
        <span class="starter starter--ghost">
          <button type="button" @click="showTemplateForm = !showTemplateForm">
            <AppIcon name="plus" :size="12" /> {{ t('planner.starters.saveCurrent') }}
          </button>
        </span>
      </div>

      <div v-if="showTemplateForm" class="save-form">
        <label class="filter filter--grow">
          <span>{{ t('planner.template.name') }}</span>
          <input v-model="templateName" :placeholder="t('planner.template.namePlaceholder')" />
        </label>
        <label class="filter filter--grow">
          <span>{{ t('planner.template.note') }}</span>
          <input v-model="templateNote" :placeholder="t('planner.template.notePlaceholder')" />
        </label>
        <button class="btn" type="button" :disabled="!templateName.trim() || busy" @click="saveTemplate">
          <AppIcon name="save" :size="14" /> {{ t('planner.template.save') }}
        </button>
      </div>

      <h3 class="pane__title"><AppIcon name="calendar" :size="14" /> {{ t('planner.period') }}</h3>
      <div class="row row--wrap" style="gap: 0.5rem; align-items: flex-end">
        <label class="filter">
          <span>{{ t('common.from') }}</span>
          <DateField v-model="from" />
        </label>
        <label class="filter">
          <span>{{ t('common.to') }}</span>
          <DateField v-model="to" />
        </label>
        <div class="row" style="gap: 0.3rem">
          <button class="btn btn--small" type="button" @click="period(1)">{{ t('common.day') }}</button>
          <button class="btn btn--small" type="button" @click="period(7)">{{ t('common.week') }}</button>
          <button class="btn btn--small" type="button" @click="period(30)">{{ t('common.month') }}</button>
        </div>
      </div>

      <h3 class="pane__title"><AppIcon name="dumbbell" :size="14" /> {{ t('planner.training') }}</h3>
      <div class="modes">
        <button
          v-for="item in TRAINING_MODES"
          :key="item"
          class="mode"
          :class="{ 'mode--on': mode === item }"
          type="button"
          @click="mode = item"
        >
          <strong>{{ pick(TRAINING_MODE_TITLES[item]) }}</strong>
          <span class="tiny muted">{{ pick(TRAINING_MODE_NOTES[item]) }}</span>
        </button>
      </div>

      <div v-if="mode === 'manual'" class="manual">
        <div v-for="(entry, index) in manual" :key="index" class="row row--wrap" style="gap: 0.5rem">
          <select v-model.number="entry.weekday" style="width: 7rem">
            <option v-for="day in 7" :key="day" :value="day">{{ t(`weekday.${day}`) }}</option>
          </select>
          <select v-model="entry.type" class="grow" style="min-width: 10rem">
            <option v-for="(title, key) in WORKOUT_TITLES" :key="key" :value="key">
              {{ pick(title) }}
            </option>
          </select>
          <input v-model.number="entry.durationMin" type="number" min="5" max="600" style="width: 6rem" />
          <span class="tiny muted">мин</span>
          <button class="btn btn--small" type="button" @click="manual.splice(index, 1)">убрать</button>
        </div>
        <button class="btn btn--small" type="button" @click="addManual">
          <AppIcon name="plus" :size="13" /> {{ t('planner.training.add') }}
        </button>
      </div>

      <div v-else class="volume">
        <span class="volume__label">{{ t('planner.training.sessions') }}</span>
        <div class="row row--wrap" style="gap: 0.4rem">
          <button
            class="btn btn--small"
            :class="{ 'btn--primary': sessionsPerWeek === null }"
            type="button"
            @click="sessionsPerWeek = null"
          >
            {{ t('planner.training.auto') }}
          </button>
          <button
            class="btn btn--small"
            :class="{ 'btn--primary': sessionsPerWeek !== null }"
            type="button"
            @click="sessionsPerWeek = sessionsPerWeek ?? suggestedSessions"
          >
            {{ t('planner.training.manual') }}
          </button>
          <input
            v-if="sessionsPerWeek !== null"
            v-model.number="sessionsPerWeek"
            type="number"
            min="0"
            max="14"
            style="width: 5rem"
          />
        </div>
        <p class="tiny muted" style="margin: 0.35rem 0 0; max-width: 44rem">
          {{ volumeHint }}
        </p>
      </div>

      <h3 class="pane__title"><AppIcon name="meal" :size="14" /> {{ t('planner.meals') }}</h3>
      <div class="checks">
        <label v-for="meal in MEALS" :key="meal" class="check">
          <input
            type="checkbox"
            :checked="meals.includes(meal)"
            :disabled="meals.length === 1 && meals.includes(meal)"
            @change="toggleMeal(meal)"
          />
          <span>{{ pick(MEAL_TITLES[meal]) }}</span>
        </label>
      </div>

      <!-- ── из чего собирать ─────────────────────────────────────────────── -->
      <h3 class="pane__title"><AppIcon name="search" :size="14" /> {{ t('planner.pool') }}</h3>
      <p class="tiny muted" style="margin: -0.25rem 0 0.5rem">
        {{ t('planner.pool.lede') }}
      </p>
      <div class="row row--wrap" style="gap: 0.5rem; align-items: flex-end">
        <label class="filter">
          <span>{{ t('planner.pool.from') }}</span>
          <DateField v-model="poolFrom" />
        </label>
        <label class="filter">
          <span>{{ t('planner.pool.to') }}</span>
          <DateField v-model="poolTo" />
        </label>
        <button class="btn btn--small" type="button" @click="poolOpen = !poolOpen">
          {{ poolOpen ? '▾' : '▸' }}
          {{
            poolKeys.length > 0
              ? t('planner.pool.picked', { picked: poolKeys.length, count: pool.length })
              : t('planner.pool.all', { count: pool.length })
          }}
        </button>
        <button
          v-if="poolKeys.length > 0"
          class="btn btn--small"
          type="button"
          @click="poolKeys = []"
        >
          {{ t('planner.pool.clear') }}
        </button>
      </div>

      <div v-if="poolOpen" class="dish-picker">
        <input v-model="poolSearch" :placeholder="t('plans.searchPlaceholder')" />
        <div class="dish-picker__list">
          <label v-for="item in poolFiltered" :key="item.key" class="dish-picker__row">
            <input
              type="checkbox"
              :checked="poolKeys.includes(item.key)"
              @change="togglePoolKey(item.key)"
            />
            <span class="grow">{{ item.name }}</span>
            <span class="tiny muted">{{ item.meals.map((m) => pick(MEAL_TITLES[m])).join(', ') }}</span>
            <span class="tiny mono">{{ item.entries }}×</span>
          </label>
          <p v-if="poolFiltered.length === 0" class="tiny muted">Ничего не нашлось.</p>
        </div>
      </div>

      <h3 class="pane__title"><AppIcon name="target" :size="14" /> {{ t('planner.basic') }}</h3>
      <SettingField
        v-for="spec in basicSettings"
        :key="spec.key"
        :spec="spec"
        :value="values[spec.key] ?? null"
        @update="values[spec.key] = $event"
      />

      <button class="btn btn--small disclose" type="button" @click="showAdvanced = !showAdvanced">
        {{ showAdvanced ? '▾' : '▸' }}
        {{ t('planner.advanced', { count: (schema?.settings.length ?? 0) - basicSettings.length }) }}
      </button>

      <div v-if="showAdvanced" class="advanced">
        <p class="tiny muted">
          {{ t('planner.advanced.lede') }}
        </p>

        <div v-for="entry in groupsWithSettings" :key="entry.group.key" class="group">
          <button
            class="group__head"
            type="button"
            @click="openGroups[entry.group.key] = !openGroups[entry.group.key]"
          >
            <span class="day__arrow">{{ openGroups[entry.group.key] ? '▾' : '▸' }}</span>
            <strong>{{ pick(entry.group.title) }}</strong>
            <span class="tiny muted">{{ t('planner.advanced.count', { count: entry.settings.length }) }}</span>
          </button>

          <div v-if="openGroups[entry.group.key]" class="group__body">
            <p class="tiny muted">{{ pick(entry.group.description) }}</p>
            <SettingField
              v-for="spec in entry.settings"
              :key="spec.key"
              :spec="spec"
              :value="values[spec.key] ?? null"
              @update="values[spec.key] = $event"
            />
          </div>
        </div>
      </div>

      <div class="row row--wrap actions">
        <button class="btn btn--primary" type="button" :disabled="busy" @click="generate(true)">
          <AppIcon name="play" :size="14" />
          {{ busy ? t('planner.generating') : t('planner.generate') }}
        </button>
        <button v-if="plan" class="btn" type="button" :disabled="busy" @click="generate(true)">
          <AppIcon name="swap" :size="14" /> {{ t('planner.again') }}
        </button>
        <button v-if="plan" class="btn" type="button" :disabled="busy" @click="generate(false)">
          {{ t('planner.sameSeed') }}
        </button>
        <span v-if="pinned.length > 0" class="chip chip--info">
          {{ t('planner.pinned', { count: pinned.length }) }}
        </span>
        <button v-if="pinned.length > 0" class="btn btn--small" type="button" @click="pinned = []">
          {{ t('planner.unpin') }}
        </button>
      </div>
    </section>

    <!-- ── результат ──────────────────────────────────────────────────────── -->
    <section v-if="plan" class="card">
      <h2><AppIcon name="calendar" :size="16" /> {{ t('planner.result') }}</h2>

      <div class="stats">
        <div>
          <div class="stat__label">{{ t('planner.result.days') }}</div>
          <div class="stat__value">{{ plan.summary.days }}</div>
        </div>
        <div>
          <div class="stat__label">{{ t('planner.result.avgKcal') }}</div>
          <div class="stat__value">{{ num(plan.summary.avgEnergyKcal) }}</div>
        </div>
        <div>
          <div class="stat__label">{{ t('planner.result.avgPerDay') }}</div>
          <div class="stat__value" style="font-size: 1rem">
            <MacroSet
              :protein="plan.summary.avgProteinG"
              :carbs="plan.summary.avgCarbsG"
              :fat="plan.summary.avgFatG"
              :fiber="plan.summary.avgFiberG"
            />
          </div>
        </div>
        <div>
          <div class="stat__label">{{ t('planner.result.trainings') }}</div>
          <div class="stat__value">{{ plan.summary.workouts }}</div>
          <div class="tiny muted">
            {{ t('planner.result.trainingsNote', { minutes: plan.summary.trainingMinutes, rest: plan.summary.restDays }) }}
          </div>
        </div>
      </div>

      <div v-for="(warning, index) in plan.warnings" :key="index" class="alert alert--warn">
        {{ message(warning) }}
      </div>

      <div v-for="day in plan.days" :key="day.date" class="plan-day">
        <button
          class="day__head"
          type="button"
          @click="openDay = openDay === day.date ? null : day.date"
        >
          <span class="day__arrow">{{ openDay === day.date ? '▾' : '▸' }}</span>
          <span class="day__date">
            <strong>{{ day.date }}</strong>
            <span class="tiny muted">{{ t(`weekday.${day.weekday}`) }}</span>
          </span>
          <span class="day__block">
            <span class="day__label">{{ t('planner.day.target') }}</span>
            <span class="day__value">{{ num(day.targets.energyKcal) }} ккал</span>
          </span>
          <span class="day__block">
            <span class="day__label">{{ t('planner.day.inMenu') }}</span>
            <span class="day__value">{{ num(day.totals.energyKcal) }} ккал</span>
            <MacroSet
              :protein="day.totals.proteinG"
              :carbs="day.totals.carbsG"
              :fat="day.totals.fatG"
              :fiber="day.totals.fiberG"
              compact
            />
          </span>
          <span class="day__block">
            <span class="day__label">{{ t('planner.day.balance') }}</span>
            <span v-if="day.balance" class="chip" :class="BALANCE_TONE[day.balance]">
              {{ signedKcal(day.balanceKcal) }}
            </span>
            <span v-else class="chip chip--mute">{{ t('planner.day.noBalance') }}</span>
            <span class="tiny muted">
              {{ day.balance ? t(`balance.${day.balance}`) : '' }} ·
              {{ t('planner.day.burn', { value: num(day.burnKcal) }) }}
            </span>
          </span>
          <span class="day__block grow">
            <span class="day__label">{{ t('planner.day.trainings') }}</span>
            <span class="tiny">
              {{
                day.workouts.length === 0
                  ? t('planner.day.rest')
                  : day.workouts
                      .map((w) => `${pick(workoutTitle(w.type))} ${w.durationMin} ${t('common.min')}`)
                      .join(', ')
              }}
            </span>
            <span v-if="day.workoutKcal" class="tiny muted">{{ num(day.workoutKcal) }} ккал</span>
          </span>
          <span v-if="day.warnings.length" class="chip chip--warn">
            {{ notesLabel(day.warnings.length) }}
          </span>
        </button>

        <div v-if="openDay === day.date" class="day__body">
          <div v-for="(warning, index) in day.warnings" :key="index" class="alert alert--warn">
            {{ message(warning) }}
          </div>

          <h4 class="pane__title" style="margin-top: 0">
            <AppIcon name="dumbbell" :size="14" />
            {{
              day.workouts.length === 0
                ? t('planner.day.rest')
                : t('planner.day.trainingsCount', { count: day.workouts.length })
            }}
          </h4>
          <p v-if="day.workouts.length === 0" class="tiny muted" style="margin: -0.25rem 0 0.6rem">
            {{ t('planner.day.restNote') }}
          </p>
          <ul v-if="day.workouts.length > 0" class="workouts">
            <li v-for="(workout, index) in day.workouts" :key="index" class="workout">
              <span class="chip" :class="workout.group === 'strength' ? 'chip--info' : 'chip--ok'">
                {{ t(`workout.${workout.group}`) }}
              </span>
              <select
                class="workout__type"
                :value="workout.type"
                :aria-label="t('planner.training.type', { index: index + 1 })"
                @change="setWorkoutType(day, index, ($event.target as HTMLSelectElement).value)"
              >
                <option v-for="type in plan.workoutTypes" :key="type.type" :value="type.type">
                  {{ pick(workoutTitle(type.type)) }}
                </option>
              </select>
              <input
                class="workout__time"
                type="number"
                min="5"
                max="600"
                step="5"
                :value="workout.durationMin"
                :aria-label="t('planner.training.duration')"
                @change="setWorkoutTime(day, index, ($event.target as HTMLInputElement).value)"
              />
              <span class="tiny muted">мин</span>
              <span class="mono tiny workout__kcal">≈ {{ num(workout.energyKcal) }} ккал</span>
              <button class="row-btn" type="button" :title="t('planner.remove')" @click="removeWorkout(day, index)">
                <AppIcon name="trash" :size="13" />
              </button>
            </li>
          </ul>
          <button class="btn btn--small" type="button" @click="addWorkout(day)">
            <AppIcon name="plus" :size="13" /> {{ t('planner.training.add') }}
          </button>
          <p class="tiny muted" style="margin: 0.35rem 0 0.8rem">
            {{ t('planner.training.priceNote') }}
          </p>

          <h4 class="pane__title"><AppIcon name="meal" :size="14" /> {{ t('planner.day.menu') }}</h4>
          <div class="meals">
            <div v-for="meal in day.meals" :key="meal.meal" class="meal-card">
              <div class="row row--between">
                <strong>{{ pick(MEAL_TITLES[meal.meal]) }}</strong>
                <span class="mono tiny">
                  {{ num(meal.totals.energyKcal) }} / {{ num(meal.targetKcal) }} ккал
                </span>
              </div>

              <ul class="dishes">
                <li v-for="(item, index) in meal.items" :key="`${item.key}-${index}`" class="dish">
                  <span class="dish__name">{{ item.name }}</span>
                  <input
                    class="dish__amount"
                    type="number"
                    min="1"
                    :value="item.amount"
                    :aria-label="t('planner.amount', { name: item.name })"
                    @change="setAmount(day.date, meal.meal, index, ($event.target as HTMLInputElement).value)"
                  />
                  <span class="tiny muted dish__unit">{{ unit(item.unit) }}</span>
                  <span class="mono dish__kcal">{{ num(item.energyKcal) }}</span>
                  <button
                    class="row-btn"
                    type="button"
                    :title="t('planner.swap.action')"
                    @click="swapping = { date: day.date, meal: meal.meal, index }; swapSearch = ''"
                  >
                    <AppIcon name="swap" :size="13" />
                  </button>
                  <button
                    class="row-btn"
                    :class="{ 'row-btn--on': isPinned(day.date, meal.meal, item.key) }"
                    type="button"
                    :title="t('planner.pin.action')"
                    @click="togglePin(day.date, meal.meal, item.key, item.amount)"
                  >
                    <AppIcon name="pin" :size="13" />
                  </button>
                </li>
              </ul>

              <MacroSet
                :protein="meal.totals.proteinG"
                :carbs="meal.totals.carbsG"
                :fat="meal.totals.fatG"
                :fiber="meal.totals.fiberG"
                :digits="1"
              />
            </div>
          </div>
        </div>
      </div>

      <div class="save-form save-form--plan">
        <label class="filter filter--grow">
          <span>{{ t('common.name') }}</span>
          <input v-model="planName" :placeholder="t('planner.save.name')" />
        </label>
        <div class="filter filter--grow">
          <span>{{ t('plans.tags') }}</span>
          <TagField v-model="planTags" :known="knownTags" />
        </div>
        <button class="btn btn--primary" type="button" :disabled="busy" @click="savePlan">
          <AppIcon name="save" :size="14" /> {{ t('common.save') }}
        </button>
        <NuxtLink :to="`/accounts/${id}/plans`" class="btn btn--small">
          <AppIcon name="archive" :size="13" /> {{ t('nav.plans') }}
        </NuxtLink>
      </div>
    </section>


    <!-- ── замена блюда ───────────────────────────────────────────────────── -->
    <div v-if="swapping" class="scrim" @click="swapping = null" />
    <div v-if="swapping" class="swap" role="dialog" :aria-label="t('common.search')">
      <div class="row row--between">
        <strong>{{ t('planner.swap.title') }}</strong>
        <button class="btn btn--small" type="button" @click="swapping = null">
          {{ t('common.close') }}
        </button>
      </div>
      <input v-model="swapSearch" :placeholder="t('plans.searchPlaceholder')" />
      <div class="swap__list">
        <button
          v-for="item in swapOptions"
          :key="item.key"
          class="swap__row"
          type="button"
          @click="replaceItem(item.key)"
        >
          <span class="grow">{{ item.name }}</span>
          <span class="tiny mono">
            {{ num(item.typicalAmount, 1) }}
            {{ item.kind === 'recipe' ? t('unit.portion') : t(`unit.${item.baseUnit ?? 'g'}`) }}
          </span>
          <span class="tiny muted">
            {{ Math.round(item.per.energyKcal * item.typicalAmount) }} {{ t('common.kcal') }}
          </span>
        </button>
        <p v-if="swapOptions.length === 0" class="tiny muted">{{ t('common.nothing') }}</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
h2 {
  display: flex;
  align-items: center;
  gap: 0.45rem;
}
.pane__title {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  font-size: 0.78rem;
  font-weight: 600;
  color: var(--ink-3);
  margin: 1.1rem 0 0.5rem;
}

/* значки в таблице норм — те же эмодзи, что в MacroSet */
.mark {
  margin-right: 0.35rem;
}

.sources {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.3rem 0.7rem;
  margin: 0.9rem 0 0;
  padding-top: 0.7rem;
  border-top: 1px solid var(--line-soft);
  font-size: 0.76rem;
}
.sources a {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  color: var(--ink-3);
  text-decoration: none;
  border-bottom: 1px dashed color-mix(in oklab, var(--ink-3) 55%, transparent);
}
.sources a:hover {
  color: var(--accent-ink);
  border-bottom-color: currentColor;
}

.starters__note {
  margin: 0 0 0.5rem;
  max-width: 52rem;
}
.starters__note strong {
  color: var(--ink-2);
}

.volume {
  margin-top: 0.7rem;
}
.volume__label {
  display: block;
  font-size: 0.82rem;
  font-weight: 500;
  color: var(--ink-2);
  margin-bottom: 0.35rem;
}

/* строка тренировки: вид и время правятся прямо здесь */
.workouts {
  list-style: none;
  margin: 0 0 0.5rem;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}
.workout {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
  padding: 0.4rem 0.6rem;
  border: 1px solid var(--line-soft);
  border-radius: var(--radius-sm);
  background: var(--surface);
  font-size: 0.85rem;
}
.workout__type {
  width: 11rem;
  min-height: 30px;
  font-size: 0.8rem;
}
.workout__time {
  width: 4.4rem;
  min-height: 30px;
  font-size: 0.8rem;
  text-align: right;
}
.workout__kcal {
  margin-left: auto;
  color: var(--ink-2);
  white-space: nowrap;
}

/* наборы — строка, а не плита между конструктором и результатом */
.starters {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.35rem;
  margin-bottom: 0.5rem;
}
.starter {
  display: inline-flex;
  align-items: center;
  min-height: 28px;
  border: 1px solid var(--line);
  border-radius: 999px;
  background: var(--surface);
  color: var(--ink-2);
  font-size: 0.8rem;
  transition: background 0.15s, color 0.15s, border-color 0.15s;
}
.starter > button {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  padding: 0 0.7rem;
  min-height: 26px;
  border: none;
  border-radius: 999px;
  background: none;
  color: inherit;
  font: inherit;
  cursor: pointer;
}
.starter:hover {
  border-color: color-mix(in oklab, var(--accent) 45%, var(--line));
  color: var(--ink);
}
.starter--on {
  border-color: var(--accent);
  background: var(--accent-bg);
  color: var(--accent-ink);
}
.starter--ghost {
  border-style: dashed;
  padding: 0;
}
.starter__x {
  padding: 0 0.5rem 0 0.1rem;
  color: var(--ink-3);
}
.starter__x:hover {
  color: var(--bad);
}

.save-form {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 0.7rem;
  padding: 0.8rem;
  margin: 0.5rem 0;
  border: 1px solid var(--line-soft);
  border-radius: var(--radius-sm);
  background: var(--sunk);
}
.save-form--plan {
  margin-top: 1.2rem;
}

.modes {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(15rem, 100%), 1fr));
  gap: 0.5rem;
}
.mode {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  padding: 0.6rem 0.8rem;
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  background: var(--surface);
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.mode--on {
  border-color: var(--accent);
  background: var(--accent-bg);
}
.manual {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  margin-top: 0.5rem;
}

/* выбор блюд */
.dish-picker {
  margin-top: 0.6rem;
  padding: 0.6rem;
  border: 1px solid var(--line-soft);
  border-radius: var(--radius-sm);
  background: var(--sunk);
}
.dish-picker__list {
  max-height: 18rem;
  overflow-y: auto;
  margin-top: 0.5rem;
}
.dish-picker__row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.25rem 0.3rem;
  border-radius: var(--radius-xs);
  font-size: 0.84rem;
  cursor: pointer;
}
.dish-picker__row:hover {
  background: var(--surface);
}

.disclose {
  margin-top: 0.8rem;
}
.advanced {
  margin-top: 0.6rem;
  padding: 0.6rem 0.8rem;
  border: 1px solid var(--line-soft);
  border-radius: var(--radius-sm);
  background: var(--sunk);
}
.group {
  border-top: 1px solid var(--line-soft);
}
.group__head {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  width: 100%;
  padding: 0.55rem 0;
  border: none;
  background: none;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.group__body {
  padding-bottom: 0.6rem;
}
.actions {
  gap: 0.5rem;
  margin-top: 1rem;
  align-items: center;
}

/* ── день плана ─────────────────────────────────────────────────────────── */
.plan-day {
  border: 1px solid var(--line-soft);
  border-radius: var(--radius-sm);
  margin-top: 0.4rem;
  overflow: hidden;
}
.day__head {
  display: grid;
  grid-template-columns:
    0.8rem 6.5rem minmax(6rem, auto) minmax(9rem, auto) minmax(8rem, auto) 1fr auto;
  align-items: center;
  gap: 0.9rem;
  width: 100%;
  padding: 0.6rem 0.8rem;
  border: none;
  background: none;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.day__head:hover {
  background: var(--sunk);
}
.day__arrow {
  color: var(--ink-3);
  font-size: 0.75rem;
  width: 0.8rem;
  flex: none;
}
.day__date {
  display: flex;
  flex-direction: column;
  font-family: var(--font-mono);
  letter-spacing: -0.03em;
  width: 7rem;
  flex: none;
}
.day__block {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  min-width: 0;
}
.day__label {
  font-family: var(--font-mono);
  font-size: 0.68rem;
  font-weight: 500;
  color: var(--ink-3);
}
.day__value {
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
.day__body {
  border-top: 1px solid var(--line-soft);
  background: var(--sunk);
  padding: 0.7rem 0.8rem;
}
.meals {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(17rem, 100%), 1fr));
  gap: 0.6rem;
}
.meal-card {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  padding: 0.6rem 0.7rem;
  border: 1px solid var(--line-soft);
  border-radius: var(--radius-sm);
  background: var(--surface);
  min-width: 0;
}

/* строка блюда: имя переносится, остальное держит ширину */
.dishes {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
}
.dish {
  display: grid;
  grid-template-columns: 1fr 3.4rem 1.6rem 2.6rem auto auto;
  align-items: center;
  gap: 0.3rem;
  font-size: 0.82rem;
  padding: 0.15rem 0;
  border-bottom: 1px solid var(--line-soft);
}
.dish:last-child {
  border-bottom: none;
}
.dish__name {
  min-width: 0;
  overflow-wrap: anywhere;
}
.dish__amount {
  min-height: 26px;
  padding: 0 0.25rem;
  font-size: 0.76rem;
  text-align: right;
  border-radius: var(--radius-xs);
}
.dish__unit {
  white-space: nowrap;
}
.dish__kcal {
  text-align: right;
  font-size: 0.78rem;
  color: var(--ink-2);
}
/* мелкая кнопка в строке — и у блюда, и у тренировки */
.row-btn {
  display: inline-grid;
  place-items: center;
  width: 1.5rem;
  height: 1.5rem;
  border: none;
  border-radius: var(--radius-xs);
  background: none;
  color: var(--ink-3);
  cursor: pointer;
}
.row-btn:hover {
  background: var(--sunk);
  color: var(--ink);
}
.row-btn--on {
  color: var(--accent-ink);
  background: var(--accent-bg);
}

/* ── замена блюда ───────────────────────────────────────────────────────── */
.scrim {
  position: fixed;
  inset: 0;
  z-index: 30;
  background: var(--scrim);
}
.swap {
  position: fixed;
  z-index: 31;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: min(30rem, calc(100vw - 2rem));
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding: 0.9rem;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  box-shadow: var(--shadow-lift);
}
.swap__list {
  max-height: 24rem;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
}
.swap__row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  width: 100%;
  padding: 0.4rem 0.5rem;
  border: none;
  border-radius: var(--radius-xs);
  background: none;
  color: inherit;
  font: inherit;
  font-size: 0.85rem;
  text-align: left;
  cursor: pointer;
}
.swap__row:hover {
  background: var(--accent-bg);
}

@media (max-width: 900px) {
  .day__head {
    display: flex;
    flex-wrap: wrap;
    gap: 0.6rem;
  }
  .day__block {
    min-width: 8rem;
  }
}
@media (max-width: 46rem) {
  .day__date {
    width: auto;
  }
  .dish {
    grid-template-columns: 1fr 3.2rem 1.4rem auto auto;
  }
  .dish__kcal {
    display: none;
  }
  .meals {
    grid-template-columns: 1fr;
  }
}
</style>
