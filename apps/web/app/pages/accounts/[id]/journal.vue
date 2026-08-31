<script setup lang="ts">
import {
  MEAL_TITLES,
  unitLabel,
  workoutTitle,
  type AccountDto,
  type JournalDayDetailDto,
  type JournalDayDto,
  type PageDto,
} from '@fatoff/contracts'

/**
 * День целиком: приход и расход рядом, с раскрытием до состава приёма пищи.
 *
 * Подробности догружаются по клику и остаются в памяти страницы: повторное
 * раскрытие того же дня в сеть не ходит, а грузить состав всех дней сразу — это
 * десятки тысяч строк ради двадцати видимых.
 */
const api = useApi()
const { t, message, pick, locale } = useI18n()
const route = useRoute()
const id = route.params.id as string

const account = ref<AccountDto | null>(null)
const days = ref<JournalDayDto[]>([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(25)
const from = ref('')
const to = ref('')
/**
 * Какие дни показывать — одно значение из трёх, а не два флажка.
 *
 * Флажков было два: «только с едой» и «есть съедено и потрачено». Второй
 * включал первый внутри себя, и вместе они образовывали состояние, которое
 * ничего не значило: галочка стоит, а ничего не меняет. Три взаимоисключающих
 * кнопки говорят то же самое и не дают собрать бессмысленную комбинацию.
 */
const SCOPES = ['all', 'food', 'both'] as const
type Scope = (typeof SCOPES)[number]
const scope = ref<Scope>('all')
/*
 * Четыре сортировки: оценка, белок, калории, калории тренировок. Их назвал
 * заказчик, прежние — по дате, балансу и шагам — убраны (D-071).
 *
 * У каждой три состояния, и переключаются они одной кнопкой по кругу:
 * убывание → возрастание → выключено. Третье состояние — не украшение, а
 * единственная дорога обратно к порядку по дате: отдельной кнопки у него нет.
 */
const SORTS = ['score', 'protein', 'energy', 'workout'] as const
type Sort = (typeof SORTS)[number]
const sort = ref<Sort | null>(null)
const dir = ref<'asc' | 'desc'>('desc')

const loading = ref(false)
const error = ref('')

/** Раскрытые дни и приёмы пищи; подробности кэшируются по дате. */
const openDay = ref<string | null>(null)
const openMeal = ref<string | null>(null)
const details = ref<Record<string, JournalDayDetailDto>>({})
const detailLoading = ref('')

async function load(): Promise<void> {
  loading.value = true
  error.value = ''
  try {
    const query: Record<string, string> = {
      page: String(page.value),
      pageSize: String(pageSize.value),
    }
    // сортировка не выбрана — не шлём её вовсе: пустое значение на сервере
    // означает порядок по дате, и отдельного имени у него нет
    if (sort.value) {
      query.sort = sort.value
      query.dir = dir.value
    }
    if (from.value) query.from = from.value
    if (to.value) query.to = to.value
    if (scope.value === 'food') query.withFood = 'true'
    if (scope.value === 'both') query.withBalance = 'true'

    const result = await api.get<PageDto<JournalDayDto>>(
      `/accounts/${id}/journal/days?${new URLSearchParams(query).toString()}`,
    )
    days.value = result.items
    total.value = result.total
  } catch (caught) {
    error.value = errorMessage(caught)
    days.value = []
    total.value = 0
  } finally {
    loading.value = false
  }
}

async function toggleDay(date: string): Promise<void> {
  openMeal.value = null
  if (openDay.value === date) {
    openDay.value = null
    return
  }
  openDay.value = date

  if (details.value[date]) return
  detailLoading.value = date
  try {
    details.value[date] = await api.get<JournalDayDetailDto>(`/accounts/${id}/journal/days/${date}`)
  } catch (caught) {
    error.value = errorMessage(caught)
    openDay.value = null
  } finally {
    detailLoading.value = ''
  }
}

function toggleMeal(date: string, meal: string): void {
  const key = `${date}:${meal}`
  openMeal.value = openMeal.value === key ? null : key
}

/** Круг из трёх состояний: убывание → возрастание → выключено. */
function sortBy(column: Sort): void {
  if (sort.value !== column) {
    sort.value = column
    dir.value = 'desc'
  } else if (dir.value === 'desc') {
    dir.value = 'asc'
  } else {
    sort.value = null
    dir.value = 'desc'
  }
  page.value = 1
  void load()
}

const arrow = (column: Sort): string =>
  sort.value === column ? (dir.value === 'desc' ? ' ↓' : ' ↑') : ''

watch([from, to, scope], () => {
  page.value = 1
  void load()
})
watch([page, pageSize], load)

onMounted(async () => {
  try {
    account.value = await api.get<AccountDto>(`/accounts/${id}`)
  } catch (caught) {
    error.value = errorMessage(caught)
  }
  await load()
})

/** Уровень составляющей: тем же порогом, что и цвет кружка оценки. */
const level = (share: number): 'ok' | 'mid' | 'low' =>
  share >= 0.75 ? 'ok' : share >= 0.5 ? 'mid' : 'low'

const unit = (value: string): string => unitLabel(locale.value, value)

const num = (value: number | null | undefined, digits = 0): string =>
  value === null || value === undefined
    ? '—'
    : value.toLocaleString('ru-RU', { maximumFractionDigits: digits })

const signed = (value: number | null): string =>
  value === null ? '—' : `${value > 0 ? '+' : ''}${num(value)}`

const hours = (minutes: number | null | undefined): string =>
  minutes === null || minutes === undefined ? '—' : `${(minutes / 60).toFixed(1)} ${t('common.hour')}`

const BALANCE_TONE: Record<string, string> = {
  deficit: 'chip--ok',
  even: 'chip--info',
  surplus: 'chip--warn',
}

</script>

<template>
  <div>
    <PageHead :title="t('nav.journal')" :back="`/accounts/${id}`">
      {{ t('journal.lede') }}
    </PageHead>

    <!-- что означает кружок: без этого число в нём — просто число -->
    <div class="legend">
      <AppIcon name="gauge" :size="15" />
      <span class="tiny">
        <strong>{{ t('journal.legend.title') }}</strong> {{ t('journal.legend.note') }}
      </span>
      <span class="legend__scale">
        <span class="legend__step"><i class="legend__dot legend__dot--ok" />{{ t('journal.legend.high') }}</span>
        <span class="legend__step"><i class="legend__dot legend__dot--mid" />{{ t('journal.legend.mid') }}</span>
        <span class="legend__step"><i class="legend__dot legend__dot--low" />{{ t('journal.legend.low') }}</span>
      </span>
    </div>

    <div v-if="error" class="alert alert--bad">{{ error }}</div>

    <div class="card filters">
      <label class="filter">
        <span>{{ t('common.from') }}</span>
        <DateField v-model="from" />
      </label>
      <label class="filter">
        <span>{{ t('common.to') }}</span>
        <DateField v-model="to" />
      </label>
      <div class="scope">
        <span class="scope__label">{{ t('journal.scope') }}</span>
        <div class="scope__row" role="radiogroup" :aria-label="t('journal.scope')">
          <button
            v-for="item in SCOPES"
            :key="item"
            class="pill"
            :class="{ 'pill--on': scope === item }"
            type="button"
            role="radio"
            :aria-checked="scope === item"
            :title="t(`journal.scope.${item}.note`)"
            @click="scope = item"
          >
            {{ t(`journal.scope.${item}`) }}
          </button>
        </div>
      </div>
      <div class="grow" />
      <div class="row row--wrap sorts" style="gap: 0.3rem">
        <button
          v-for="item in SORTS"
          :key="item"
          class="btn btn--small"
          :class="{ 'btn--primary': sort === item }"
          type="button"
          :aria-pressed="sort === item"
          @click="sortBy(item)"
        >
          {{ t(`journal.sort.${item}`) }}{{ arrow(item) }}
        </button>
      </div>

      <!-- пояснение к выбранному отбору: подсказка по наведению на телефоне
           недоступна вовсе, а угадывать разницу между кнопками не должно быть
           нужно -->
      <p class="tiny muted filters__note">
        {{ t(`journal.scope.${scope}.note`) }}
        <template v-if="sort"> {{ t('journal.sort.note') }}</template>
      </p>
    </div>

    <div v-if="loading" class="card"><span class="spinner" /> {{ t('common.loading') }}</div>
    <div v-else-if="days.length === 0" class="card muted">{{ t('journal.empty') }}</div>

    <div v-for="day in days" v-else :key="day.date" class="card day">
      <!-- ── строка дня ──────────────────────────────────────────────────── -->
      <button class="day__head" type="button" @click="toggleDay(day.date)">
        <span class="day__arrow">{{ openDay === day.date ? '▾' : '▸' }}</span>
        <DayScore :score="day.score" />

        <span class="day__date">
          <strong>{{ day.date }}</strong>
          <span class="tiny muted">{{ t(`weekday.${day.weekday}`) }}</span>
        </span>

        <span class="day__block">
          <span class="day__label">{{ t('journal.eaten') }}</span>
          <span class="day__value">{{ num(day.energyInKcal) }} {{ t('common.kcal') }}</span>
          <MacroSet
            :protein="day.proteinG"
            :carbs="day.carbsG"
            :fat="day.fatG"
            :fiber="day.fiberG"
            compact
          />
        </span>

        <span class="day__block">
          <span class="day__label">{{ t('journal.burned') }}</span>
          <span class="day__value">{{ num(day.energyOutKcal) }} {{ t('common.kcal') }}</span>
          <span class="tiny muted">
            {{ t('journal.steps', { count: num(day.steps) }) }} ·
            {{ t('journal.sleep', { hours: hours(day.asleepMin) }) }}
          </span>
        </span>

        <span class="day__block">
          <span class="day__label">{{ t('journal.balance') }}</span>
          <span v-if="day.balance" class="chip" :class="BALANCE_TONE[day.balance]">
            {{ signed(day.balanceKcal) }} {{ t('common.kcal') }}
          </span>
          <span v-else class="chip chip--mute">{{ t('journal.noBurn') }}</span>
          <span class="tiny muted">
            {{ day.balance ? t(`balance.${day.balance}`) : t('journal.noBalance') }}
          </span>
        </span>

        <span class="day__block day__block--counts">
          <span class="tiny">{{ t('journal.meals', { count: day.meals }) }}</span>
          <span class="tiny">{{ t('journal.workouts', { count: day.workouts }) }}</span>
          <span class="tiny muted">{{ t('journal.workoutKcal', { value: num(day.workoutKcal) }) }}</span>
        </span>
      </button>

      <!-- ── подробности ─────────────────────────────────────────────────── -->
      <div v-if="openDay === day.date" class="day__body">
        <div v-if="detailLoading === day.date" class="muted"><span class="spinner" /> {{ t('common.loading') }}</div>

        <template v-else-if="details[day.date]">
          <div class="panes">
            <!-- еда -->
            <section>
              <h3 class="pane__title"><AppIcon name="meal" :size="14" /> {{ t('journal.whatEaten') }}</h3>
              <p v-if="details[day.date].meals.length === 0" class="muted tiny">
                {{ t('journal.noEntries') }}
              </p>

              <div v-for="meal in details[day.date].meals" :key="meal.meal" class="meal">
                <button class="meal__head" type="button" @click="toggleMeal(day.date, meal.meal)">
                  <span class="day__arrow">
                    {{ openMeal === `${day.date}:${meal.meal}` ? '▾' : '▸' }}
                  </span>
                  <strong class="meal__title">{{ pick(MEAL_TITLES[meal.meal]) }}</strong>
                  <span class="mono">{{ num(meal.energyKcal) }} {{ t('common.kcal') }}</span>
                  <MacroSet
                    :protein="meal.proteinG"
                    :carbs="meal.carbsG"
                    :fat="meal.fatG"
                    :fiber="meal.fiberG"
                    :digits="1"
                    compact
                  />
                  <span class="tiny muted">{{ t('journal.positions', { count: meal.items.length }) }}</span>
                </button>

                <div v-if="openMeal === `${day.date}:${meal.meal}`" class="table-wrap">
                  <table class="data">
                    <thead>
                      <tr>
                        <th>{{ t('journal.col.product') }}</th>
                        <th class="num">{{ t('journal.col.amount') }}</th>
                        <th class="num">{{ t('common.kcal') }}</th>
                        <th class="num">Б</th>
                        <th class="num">У</th>
                        <th class="num">Ж</th>
                        <th class="num">Клетч.</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr v-for="(item, index) in meal.items" :key="index">
                        <td>
                          {{ item.name }}
                          <span v-if="item.producer" class="tiny muted">· {{ item.producer }}</span>
                        </td>
                        <td class="num">
                          {{ num(item.amount, 1) }}
                          <span class="tiny muted">
                            {{ item.unit ? unit(item.unit) : (item.serving ?? '') }}
                          </span>
                        </td>
                        <td class="num">{{ num(item.energyKcal) }}</td>
                        <td class="num">{{ num(item.proteinG, 1) }}</td>
                        <td class="num">{{ num(item.carbsG, 1) }}</td>
                        <td class="num">{{ num(item.fatG, 1) }}</td>
                        <td class="num">{{ num(item.fiberG, 1) }}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </section>

            <!-- расход -->
            <section>
              <h3 class="pane__title"><AppIcon name="flame" :size="14" /> {{ t('journal.whereSpent') }}</h3>
              <div class="stats">
                <div>
                  <div class="stat__label">{{ t('journal.burn.basal') }}</div>
                  <div class="stat__value">{{ num(details[day.date].burn.basalKcal) }}</div>
                </div>
                <div>
                  <div class="stat__label">{{ t('journal.burn.active') }}</div>
                  <div class="stat__value">{{ num(details[day.date].burn.activeKcal) }}</div>
                </div>
                <div>
                  <div class="stat__label">{{ t('journal.burn.steps') }}</div>
                  <div class="stat__value">{{ num(details[day.date].burn.steps) }}</div>
                </div>
                <div>
                  <div class="stat__label">{{ t('journal.burn.distance') }}</div>
                  <div class="stat__value">{{ num(details[day.date].burn.distanceKm, 1) }}</div>
                </div>
                <div>
                  <div class="stat__label">{{ t('journal.burn.exercise') }}</div>
                  <div class="stat__value">{{ num(details[day.date].burn.exerciseMin) }}</div>
                </div>
                <div>
                  <div class="stat__label">{{ t('journal.burn.restingHr') }}</div>
                  <div class="stat__value">{{ num(details[day.date].burn.restingHr) }}</div>
                </div>
              </div>

              <p class="tiny muted" style="margin-top: 0.5rem">
                {{ t('journal.activeNote') }}
              </p>

              <h4 class="pane__title" style="margin-top: 0.9rem">
                <AppIcon name="dumbbell" :size="14" />
                {{ t('planner.day.trainingsCount', { count: details[day.date].workouts.length }) }}
              </h4>
              <p v-if="details[day.date].workouts.length === 0" class="muted tiny">
                {{ t('journal.noWorkouts') }}
              </p>
              <div v-else class="table-wrap">
                <table class="data">
                  <thead>
                    <tr>
                      <th>{{ t('journal.col.start') }}</th>
                      <th>{{ t('journal.col.kind') }}</th>
                      <th class="num">{{ t('common.min') }}</th>
                      <th class="num">{{ t('common.kcal') }}</th>
                      <th class="num">{{ t('journal.col.km') }}</th>
                      <th>{{ t('journal.col.source') }}</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="(workout, index) in details[day.date].workouts" :key="index">
                      <td class="mono">{{ workout.startedAt.slice(11, 16) }}</td>
                      <td>{{ pick(workoutTitle(workout.type)) }}</td>
                      <td class="num">{{ num(workout.durationMin) }}</td>
                      <td class="num">{{ num(workout.energyKcal) }}</td>
                      <td class="num">{{ num(workout.distanceKm, 1) }}</td>
                      <td class="tiny muted">{{ workout.source || '—' }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </section>
          </div>

          <!-- оценка -->
          <section class="score-pane">
            <h3 class="pane__title">
              <AppIcon name="gauge" :size="14" /> {{ t('journal.score.title') }}
              <span class="tiny muted">
                {{ t('journal.score.covered', { covered: details[day.date].score.covered }) }}
              </span>
            </h3>

            <div
              v-if="details[day.date].score.lowEnergyAvailability"
              class="alert alert--warn"
              style="margin: 0.5rem 0"
            >
              {{
                t('journal.score.lowEa', {
                  value: num(details[day.date].score.energyAvailability, 1),
                  threshold: 30,
                })
              }}
            </div>

            <div class="parts">
              <div v-for="part in details[day.date].score.parts" :key="part.key" class="part">
                <div class="row row--between">
                  <span>{{ t(`score.${part.key}`) }}</span>
                  <span class="mono tiny">
                    {{ part.earned === null ? '—' : `${num(part.earned, 1)} / ${part.weight}` }}
                  </span>
                </div>
                <div class="progress">
                  <div
                    class="progress__fill"
                    :class="`progress__fill--${level((part.earned ?? 0) / part.weight)}`"
                    :style="{ width: `${((part.earned ?? 0) / part.weight) * 100}%` }"
                  />
                </div>
                <div class="tiny muted">{{ message(part.note) }}</div>
              </div>
            </div>
          </section>
        </template>
      </div>
    </div>

    <DataPager v-model:page="page" v-model:page-size="pageSize" :total="total" />
  </div>
</template>

<style scoped>
/* пояснение к отбору занимает свою строку под фильтрами */
.filters__note {
  flex: 1 0 100%;
  margin: 0;
}

.scope__label {
  display: block;
  font-size: 0.82rem;
  font-weight: 500;
  color: var(--ink-2);
  margin-bottom: 0.3rem;
}
.scope__row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
}

/* овальные переключатели — те же, что у наборов настроек в «Режиме» */
.pill {
  display: inline-flex;
  align-items: center;
  min-height: 28px;
  padding: 0 0.7rem;
  border: 1px solid var(--line);
  border-radius: 999px;
  background: var(--surface);
  color: var(--ink-2);
  font: inherit;
  font-size: 0.8rem;
  cursor: pointer;
  transition: background 0.15s, color 0.15s, border-color 0.15s;
}
.pill:hover {
  border-color: color-mix(in oklab, var(--accent) 45%, var(--line));
  color: var(--ink);
}
.pill--on {
  border-color: var(--accent);
  background: var(--accent-bg);
  color: var(--accent-ink);
  font-weight: 600;
}

.day {
  padding: 0;
  overflow: hidden;
}
/*
 * Сетка, а не флекс: у колонок фиксированные доли, и длинное число в одной из
 * них не выдавливает соседнюю за край карточки.
 */
.day__head {
  display: grid;
  grid-template-columns: 0.8rem auto 6.5rem repeat(3, minmax(8rem, 1fr)) minmax(9rem, auto);
  align-items: center;
  gap: 0.9rem;
  width: 100%;
  padding: 0.75rem 1rem;
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
.day__block--counts {
  align-items: flex-end;
  text-align: right;
}
.meal__title {
  /* не .grow: там flex-basis 0, и заголовок наезжает на число рядом */
  flex: 1 1 auto;
  min-width: 4rem;
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
  padding: 0.9rem 1rem;
}
/* еде отведено больше: там таблица в семь колонок, а расход укладывается в три */
.panes {
  display: grid;
  grid-template-columns: 1.35fr 1fr;
  gap: 1.5rem;
}
@media (max-width: 60rem) {
  .panes {
    grid-template-columns: 1fr;
  }
}
/* без этого колонка с таблицей расхода распирает свою долю за счёт соседней */
.panes > section {
  min-width: 0;
}
.pane__title {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  font-size: 0.78rem;
  font-weight: 600;
  color: var(--ink-3);
  margin: 0 0 0.5rem;
}
.meal {
  border: 1px solid var(--line-soft);
  border-radius: var(--radius-sm);
  background: var(--surface);
  margin-bottom: 0.4rem;
}
.meal__head {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  width: 100%;
  padding: 0.5rem 0.7rem;
  border: none;
  background: none;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.meal__head:hover {
  background: var(--sunk);
}

/*
 * Внутри дня таблицы живут в половине ширины страницы, поэтому набираются
 * плотнее, а длинные названия переносятся: `nowrap` по умолчанию срезал бы
 * последние колонки за краем панели, и о них никто бы не узнал.
 */
.day__body table.data {
  font-size: 0.8rem;
}
.day__body table.data th,
.day__body table.data td {
  padding: 0.35rem 0.45rem;
}
.day__body table.data td:first-child,
.day__body table.data td:last-child {
  white-space: normal;
}
.score-pane {
  margin-top: 1.2rem;
  padding-top: 0.9rem;
  border-top: 1px solid var(--line-soft);
}
.parts {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(15rem, 100%), 1fr));
  gap: 0.7rem;
}
.part {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  font-size: 0.85rem;
}

/* легенда: короткая, но без неё число в кружке ничего не значит */
.legend {
  display: flex;
  align-items: flex-start;
  gap: 0.5rem;
  flex-wrap: wrap;
  padding: 0.6rem 0.8rem;
  margin-bottom: 0.75rem;
  border: 1px solid var(--line-soft);
  border-radius: var(--radius-sm);
  background: var(--sunk);
  color: var(--ink-3);
}
.legend > .tiny {
  flex: 1;
  min-width: 16rem;
}
.legend strong {
  color: var(--ink-2);
}
.legend__scale {
  display: flex;
  gap: 0.75rem;
  flex-wrap: wrap;
  font-size: 0.72rem;
  font-family: var(--font-mono);
}
.legend__step {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  white-space: nowrap;
}
.legend__dot {
  width: 0.5rem;
  height: 0.5rem;
  border-radius: 50%;
}
.legend__dot--ok {
  background: var(--ok);
}
.legend__dot--mid {
  background: var(--accent);
}
.legend__dot--low {
  background: var(--bad);
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
  .day__block--counts {
    align-items: flex-start;
    text-align: left;
  }
}
</style>
