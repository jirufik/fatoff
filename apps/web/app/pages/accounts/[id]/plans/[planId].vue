<script setup lang="ts">
import { MEAL_TITLES, unitLabel, workoutTitle } from '@fatoff/contracts'
import type { MealKey, PlanDto } from '@fatoff/contracts'

/**
 * Просмотр сохранённого плана.
 *
 * Только чтение: план разворачивается целиком, без раскрытий и без кнопок,
 * которые его меняют. Конструктор — место, где план собирают; здесь его
 * рассматривают, и всё видно сразу.
 */
const api = useApi()
const route = useRoute()
const router = useRouter()
const { t, message, pick, locale } = useI18n()
const id = route.params.id as string
const planId = route.params.planId as string

const plan = ref<PlanDto | null>(null)
const error = ref('')

onMounted(async () => {
  try {
    plan.value = await api.get<PlanDto>(`/accounts/${id}/planner/plans/${planId}`)
  } catch (caught) {
    error.value = errorMessage(caught)
  }
})

const num = (value: number | null | undefined, digits = 0): string =>
  value === null || value === undefined
    ? '—'
    : value.toLocaleString(locale.value === 'ru' ? 'ru-RU' : 'en-GB', {
        maximumFractionDigits: digits,
      })

const unit = (value: string): string => unitLabel(locale.value, value)
const mealTitle = (meal: MealKey): string => pick(MEAL_TITLES[meal])
const pickWorkout = (type: string): string => pick(workoutTitle(type))

const BALANCE_TONE: Record<string, string> = {
  deficit: 'chip--ok',
  even: 'chip--info',
  surplus: 'chip--warn',
}

const signedKcal = (value: number | null | undefined): string =>
  value === null || value === undefined
    ? '—'
    : `${value > 0 ? '+' : ''}${num(value)} ${t('common.kcal')}`

/** Открыть в конструкторе: он подхватит план из хранилища браузера. */
function openInBuilder(): void {
  if (!plan.value) return
  sessionStorage.setItem('fatoff:open-plan', JSON.stringify(plan.value.plan))
  void router.push(`/accounts/${id}/planner`)
}

const pdfHref = computed(
  () => `/api/accounts/${id}/planner/plans/${planId}/pdf?lang=${locale.value}`,
)
</script>

<template>
  <div>
    <PageHead :title="plan?.name ?? t('plans.view.title')" :back="`/accounts/${id}/plans`">
      {{ t('plans.view.lede') }}
    </PageHead>

    <div v-if="error" class="alert alert--bad">{{ error }}</div>
    <p v-else-if="!plan" class="muted"><span class="spinner" /> {{ t('common.loading') }}</p>

    <template v-else>
      <!-- ── что это за план ──────────────────────────────────────────────── -->
      <section class="card">
        <div class="row row--between row--wrap" style="gap: 0.6rem">
          <div class="grow">
            <p class="tiny muted" style="margin: 0">
              <span class="mono">{{ plan.from }} — {{ plan.to }}</span>
              · {{ plan.plan.summary.days }} {{ t('common.days') }}
              · {{ t('plans.savedAt') }} {{ plan.createdAt.slice(0, 10) }}
              · <span class="mono">{{ t('plans.view.seed', { seed: plan.plan.seed }) }}</span>
            </p>
            <div v-if="plan.tags.length > 0" class="row row--wrap" style="gap: 0.25rem; margin-top: 0.4rem">
              <span v-for="tag in plan.tags" :key="tag" class="chip chip--mute">#{{ tag }}</span>
            </div>
          </div>

          <div class="row row--wrap" style="gap: 0.35rem">
            <a class="btn btn--small" :href="pdfHref" download>
              <AppIcon name="save" :size="13" /> {{ t('plans.pdf') }}
            </a>
            <button class="btn btn--small" type="button" @click="openInBuilder">
              <AppIcon name="play" :size="13" /> {{ t('plans.openInBuilder') }}
            </button>
            <NuxtLink :to="`/accounts/${id}/plans`" class="btn btn--small">
              <AppIcon name="archive" :size="13" /> {{ t('plans.back') }}
            </NuxtLink>
          </div>
        </div>
      </section>

      <!-- ── нормы и сводка ───────────────────────────────────────────────── -->
      <section class="card">
        <h2><AppIcon name="target" :size="16" /> {{ t('pdf.targets') }}</h2>
        <div class="stats">
          <div>
            <div class="stat__value">{{ num(plan.plan.targets.computed.energyKcal) }}</div>
            <div class="stat__label">{{ t('common.kcal') }}</div>
          </div>
          <div>
            <div class="stat__value">{{ num(plan.plan.targets.computed.proteinG) }}</div>
            <div class="stat__label">{{ t('macro.protein') }}, {{ t('unit.g') }}</div>
          </div>
          <div>
            <div class="stat__value">{{ num(plan.plan.targets.computed.fatG) }}</div>
            <div class="stat__label">{{ t('macro.fat') }}, {{ t('unit.g') }}</div>
          </div>
          <div>
            <div class="stat__value">{{ num(plan.plan.targets.computed.carbsG) }}</div>
            <div class="stat__label">{{ t('macro.carbs') }}, {{ t('unit.g') }}</div>
          </div>
          <div>
            <div class="stat__value">{{ num(plan.plan.targets.computed.fiberG) }}</div>
            <div class="stat__label">{{ t('macro.fiber') }}, {{ t('unit.g') }}</div>
          </div>
        </div>
        <p class="tiny muted" style="margin: 0.6rem 0 0">
          {{ message(plan.plan.targets.basis.energy) }}
        </p>

        <h2 style="margin-top: 1.2rem">
          <AppIcon name="gauge" :size="16" /> {{ t('pdf.summary') }}
        </h2>
        <div class="stats">
          <div>
            <div class="stat__value">{{ num(plan.plan.summary.avgEnergyKcal) }}</div>
            <div class="stat__label">{{ t('pdf.avgPerDay') }}</div>
          </div>
          <div>
            <div class="stat__value">{{ plan.plan.summary.workouts }}</div>
            <div class="stat__label">{{ t('pdf.trainings') }}</div>
          </div>
          <div>
            <div class="stat__value">{{ num(plan.plan.summary.trainingMinutes) }}</div>
            <div class="stat__label">{{ t('common.min') }}</div>
          </div>
          <div>
            <div class="stat__value">{{ plan.plan.summary.restDays }}</div>
            <div class="stat__label">{{ t('pdf.restDays') }}</div>
          </div>
        </div>
      </section>

      <!-- ── предупреждения ───────────────────────────────────────────────── -->
      <section v-if="plan.plan.warnings.length > 0" class="card">
        <h2><AppIcon name="info" :size="16" /> {{ t('pdf.warnings') }}</h2>
        <ul class="notes">
          <li v-for="(warning, index) in plan.plan.warnings" :key="index">
            {{ message(warning) }}
          </li>
        </ul>
      </section>

      <!-- ── дни ──────────────────────────────────────────────────────────── -->
      <section v-for="day in plan.plan.days" :key="day.date" class="card day">
        <header class="day__head">
          <div>
            <strong class="mono day__date">{{ day.date }}</strong>
            <span class="tiny muted"> {{ t(`weekday.${day.weekday}`) }}</span>
          </div>
          <div class="day__nums">
            <span class="tiny muted">{{ t('planner.day.target') }}</span>
            <span class="mono">{{ num(day.targets.energyKcal) }}</span>
            <span class="tiny muted">{{ t('planner.day.inMenu') }}</span>
            <span class="mono">{{ num(day.totals.energyKcal) }}</span>
            <span v-if="day.balance" class="chip" :class="BALANCE_TONE[day.balance]">
              {{ signedKcal(day.balanceKcal) }}
            </span>
          </div>
        </header>

        <MacroSet
          :protein="day.totals.proteinG"
          :carbs="day.totals.carbsG"
          :fat="day.totals.fatG"
          :fiber="day.totals.fiberG"
        />

        <p v-if="day.workouts.length > 0" class="day__workouts">
          <AppIcon name="dumbbell" :size="13" />
          <span v-for="(workout, index) in day.workouts" :key="index">
            <template v-if="index > 0"> · </template>
            {{ pickWorkout(workout.type) }} {{ workout.durationMin }} {{ t('common.min') }} ·
            {{ num(workout.energyKcal) }} {{ t('common.kcal') }}
            <template v-if="workout.at"> · {{ workout.at }}</template>
          </span>
        </p>
        <p v-else class="tiny muted day__workouts">{{ t('pdf.rest') }}</p>

        <div v-for="meal in day.meals" :key="meal.meal" class="meal">
          <div class="meal__head">
            <strong>{{ mealTitle(meal.meal) }}</strong>
            <span class="mono tiny">
              {{ num(meal.totals.energyKcal) }} / {{ num(meal.targetKcal) }} {{ t('common.kcal') }}
            </span>
          </div>
          <ul class="items">
            <li v-for="item in meal.items" :key="item.key">
              <span class="items__name">{{ item.name }}</span>
              <span class="mono tiny muted">
                {{ num(item.amount) }} {{ unit(item.unit) }} · {{ num(item.energyKcal) }}
                {{ t('common.kcal') }}
              </span>
            </li>
          </ul>
          <MacroSet
            :protein="meal.totals.proteinG"
            :carbs="meal.totals.carbsG"
            :fat="meal.totals.fatG"
            :fiber="meal.totals.fiberG"
            compact
          />
        </div>

        <ul v-if="day.warnings.length > 0" class="notes">
          <li v-for="(warning, index) in day.warnings" :key="index">{{ message(warning) }}</li>
        </ul>
      </section>
    </template>
  </div>
</template>

<style scoped>
h2 {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  margin-top: 0;
}

.day {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
.day__head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.5rem;
}
.day__date {
  font-size: 1.05rem;
}
.day__nums {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.4rem;
}
.day__workouts {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.3rem;
  margin: 0;
  font-size: 0.85rem;
  color: var(--ink-2);
}

.meal {
  border-top: 1px solid var(--line-soft);
  padding-top: 0.5rem;
}
.meal__head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.4rem;
  margin-bottom: 0.25rem;
}
.items {
  list-style: none;
  margin: 0 0 0.3rem;
  padding: 0;
}
.items li {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.4rem;
  padding: 0.12rem 0;
  font-size: 0.9rem;
}
.items__name {
  min-width: 0;
  overflow-wrap: anywhere;
}

.notes {
  margin: 0;
  padding-left: 1.1rem;
  font-size: 0.85rem;
  color: var(--ink-2);
}
</style>
