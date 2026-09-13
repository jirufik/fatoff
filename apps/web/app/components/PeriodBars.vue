<script setup lang="ts">
import type { PeriodDayDto } from '@fatoff/contracts'

/**
 * Съедено против расхода по дням — парами столбиков.
 *
 * Разметкой, а не SVG: подписи дней остаются настоящим текстом и не мельчают
 * вместе с масштабом картинки, а каждый день — кнопка, в которую попадает палец.
 * Библиотека графиков ради двух рядов столбиков по-прежнему не нужна (D-016).
 *
 * Числа дня показываются по нажатию под графиком, а не подсказкой по наведению:
 * на телефоне наводить нечем (D-079).
 */
const props = defineProps<{ series: PeriodDayDto[]; today?: string | null }>()

const { t, locale } = useI18n()

/** Дальше стольких дней столбики сворачиваются в недели: иначе каждый тоньше волоса. */
const WEEKLY_AFTER = 62

interface Slot {
  key: string
  label: string
  title: string
  eaten: number | null
  burned: number | null
  /** Сегодняшний день ещё идёт: его столбики бледнее, чтобы не читались итогом. */
  partial: boolean
}

const weekly = computed(() => props.series.length > WEEKLY_AFTER)
const intl = computed(() => (locale.value === 'en' ? 'en-GB' : 'ru-RU'))

const dateOf = (iso: string): Date => new Date(`${iso}T00:00:00`)
const longDate = (iso: string): string =>
  dateOf(iso).toLocaleDateString(intl.value, { day: 'numeric', month: 'long' })

/** Среднее по дням, где значение есть: пустой день неделю не занижает (D-082). */
const average = (values: Array<number | null>): number | null => {
  const known = values.filter((value): value is number => value !== null)
  return known.length === 0 ? null : known.reduce((sum, value) => sum + value, 0) / known.length
}

const slots = computed<Slot[]>(() => {
  if (!weekly.value) {
    const few = props.series.length <= 14
    return props.series.map((day) => ({
      key: day.date,
      // неделя читается днями недели, месяц — числами
      label: few
        ? dateOf(day.date).toLocaleDateString(intl.value, { weekday: 'short' }).replace('.', '')
        : String(Number(day.date.slice(8))),
      title: longDate(day.date),
      eaten: day.eatenKcal,
      burned: day.burnedKcal,
      partial: day.date === props.today,
    }))
  }

  const weeks: Slot[] = []
  for (let index = 0; index < props.series.length; index += 7) {
    const chunk = props.series.slice(index, index + 7)
    const first = chunk[0]!
    const last = chunk[chunk.length - 1]!
    weeks.push({
      key: first.date,
      label: dateOf(first.date).toLocaleDateString(intl.value, { day: 'numeric', month: 'numeric' }),
      title: `${longDate(first.date)} – ${longDate(last.date)}`,
      eaten: average(chunk.map((day) => day.eatenKcal)),
      burned: average(chunk.map((day) => day.burnedKcal)),
      partial: chunk.some((day) => day.date === props.today),
    })
  }
  return weeks
})

/** Подпись под каждым столбиком не помещается, когда их много: оставляем через одну-пять. */
const labelEvery = computed(() => {
  const count = slots.value.length
  if (count <= 14) return 1
  if (count <= 31) return count > 16 ? 5 : 2
  return Math.ceil(count / 8)
})

const top = computed(() =>
  Math.max(0, ...slots.value.flatMap((slot) => [slot.eaten ?? 0, slot.burned ?? 0])),
)
const height = (value: number | null): string =>
  value === null || top.value <= 0 ? '0%' : `${Math.max(1.5, (value / top.value) * 100)}%`

const num = (value: number | null): string =>
  value === null ? '—' : Math.round(value).toLocaleString('ru-RU')

const picked = ref<string | null>(null)
const pickedSlot = computed(() => slots.value.find((slot) => slot.key === picked.value) ?? null)

const describe = (slot: Slot): string =>
  t('home.bars.pick', { date: slot.title, eaten: num(slot.eaten), burned: num(slot.burned) })

// другой период — другие дни: выбранный столбик прошлого периода здесь ни при чём
watch(
  () => props.series,
  () => {
    picked.value = null
  },
)
</script>

<template>
  <div class="home-bars">
    <div class="home-bars__legend">
      <span class="home-bars__key"><i class="home-bars__dot home-bars__dot--eaten" />{{ t('home.bars.eaten') }}</span>
      <span class="home-bars__key"><i class="home-bars__dot home-bars__dot--burned" />{{ t('home.bars.burned') }}</span>
    </div>

    <div class="home-bars__plot" role="group" :aria-label="t('home.bars.aria')">
      <button
        v-for="(slot, index) in slots"
        :key="slot.key"
        type="button"
        class="home-bars__day"
        :class="{ 'home-bars__day--partial': slot.partial, 'home-bars__day--on': slot.key === picked }"
        :aria-label="describe(slot)"
        :aria-pressed="slot.key === picked"
        @click="picked = picked === slot.key ? null : slot.key"
      >
        <span class="home-bars__pair">
          <span
            v-if="slot.eaten !== null"
            class="home-bars__bar home-bars__bar--eaten"
            :style="{ height: height(slot.eaten) }"
          />
          <span
            v-if="slot.burned !== null"
            class="home-bars__bar home-bars__bar--burned"
            :style="{ height: height(slot.burned) }"
          />
        </span>
        <span class="home-bars__label">{{ index % labelEvery === 0 ? slot.label : '' }}</span>
      </button>
    </div>

    <p class="home-bars__pick">
      <template v-if="pickedSlot">{{ describe(pickedSlot) }}</template>
      <template v-else>{{ weekly ? t('home.bars.weeks') : t('home.bars.hint') }}</template>
    </p>
  </div>
</template>

<style scoped>
.home-bars {
  margin-top: 0.9rem;
}

.home-bars__legend {
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem 0.9rem;
  margin-bottom: 0.45rem;
  font-size: 0.76rem;
  color: var(--ink-3);
}
.home-bars__key {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
}
.home-bars__dot {
  width: 0.6rem;
  height: 0.6rem;
  border-radius: 2px;
}

/* цвета те же, что у полосок сводки: съеденное — акцент, расход — приглушённый */
.home-bars__dot--eaten,
.home-bars__bar--eaten {
  background: var(--accent);
}
.home-bars__dot--burned,
.home-bars__bar--burned {
  background: color-mix(in oklab, var(--accent) 45%, var(--ink-3));
}

.home-bars__plot {
  display: flex;
  align-items: stretch;
  gap: 2px;
  height: 7.5rem;
}

.home-bars__day {
  flex: 1 1 0;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  padding: 0 1px;
  border: 0;
  border-radius: var(--radius-xs);
  background: none;
  color: inherit;
  font: inherit;
  cursor: pointer;
}
.home-bars__day--on {
  background: var(--sunk);
}

.home-bars__pair {
  flex: 1;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  gap: 2px;
  border-bottom: 1px solid var(--line);
}

.home-bars__bar {
  width: min(0.75rem, 45%);
  border-radius: 3px 3px 0 0;
}
.home-bars__day--partial .home-bars__bar {
  opacity: 0.45;
}

.home-bars__label {
  height: 1rem;
  overflow: hidden;
  font-family: var(--font-mono);
  font-size: 0.66rem;
  line-height: 1rem;
  color: var(--ink-3);
  text-align: center;
  white-space: nowrap;
}

.home-bars__pick {
  min-height: 1.2rem;
  margin: 0.45rem 0 0;
  font-size: 0.8rem;
  color: var(--ink-2);
}
</style>
