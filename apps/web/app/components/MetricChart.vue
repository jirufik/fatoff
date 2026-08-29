<script setup lang="ts">
/**
 * Два вида графика на дашборде: столбики (калории по дням) и линия (вес).
 *
 * Библиотека графиков ради двух форм не подключается (D-011). Правила те же,
 * что и у нормальной визуализации: столбики считаются от нуля, у линии
 * подписаны границы шкалы, цель — не второй ряд данных, а приглушённая опорная
 * линия, ось и сетка отступают на второй план, при наведении показывается
 * значение.
 */
interface Point {
  date: string
  value: number | null
}

const { t } = useI18n()

const props = withDefaults(
  defineProps<{
    points: Point[]
    kind?: 'bars' | 'line'
    /** Опорная линия: цель по калориям, целевой вес. */
    reference?: number | null
    referenceLabel?: string
    unit?: string
    digits?: number
  }>(),
  { kind: 'bars', reference: null, referenceLabel: '', unit: '', digits: 0 },
)

const W = 600
const H = 150
const PAD_L = 34
const PAD_R = 8
const PAD_T = 10
const PAD_B = 18

const known = computed(() => props.points.filter((p) => p.value !== null) as Array<Required<Point>>)

const scale = computed(() => {
  const values = known.value.map((p) => p.value)
  if (props.reference !== null) values.push(props.reference)
  if (values.length === 0) return { min: 0, max: 1 }

  const max = Math.max(...values)
  const min = Math.min(...values)
  // столбики обязаны считаться от нуля, иначе разница выглядит больше, чем есть;
  // у линии нулевая база сплющила бы сигнал — там берём поля вокруг данных
  if (props.kind === 'bars') return { min: 0, max: max * 1.08 || 1 }

  const padding = (max - min) * 0.15 || Math.abs(max) * 0.02 || 1
  return { min: min - padding, max: max + padding }
})

const PLOT = W - PAD_L - PAD_R

// единственная точка ставится по центру: у левого края она читается как обрезок
const x = (index: number): number =>
  props.points.length <= 1 ? PAD_L + PLOT / 2 : PAD_L + (PLOT * index) / (props.points.length - 1)

const y = (value: number): number => {
  const { min, max } = scale.value
  const span = max - min || 1
  return PAD_T + (H - PAD_T - PAD_B) * (1 - (value - min) / span)
}

const barWidth = computed(() =>
  // 2 пикселя между столбиками: без зазора соседние сливаются в одну заливку.
  // Потолок нужен для короткого периода: иначе один день растягивается на всю
  // ширину графика и перестаёт читаться как столбик
  Math.min(48, Math.max(1.5, PLOT / Math.max(props.points.length, 1) - 2)),
)

const barGeometry = computed(() =>
  props.points.map((point, index) => {
    if (point.value === null) return null
    const top = y(point.value)
    const base = y(scale.value.min)
    return {
      date: point.date,
      value: point.value,
      x: x(index) - barWidth.value / 2,
      y: top,
      height: Math.max(base - top, 1),
      width: barWidth.value,
    }
  }),
)

/** Разрывы в линии — это отсутствие данных, а не ноль: рвём путь. */
const linePath = computed(() => {
  const segments: string[] = []
  let open = false
  props.points.forEach((point, index) => {
    if (point.value === null) {
      open = false
      return
    }
    segments.push(`${open ? 'L' : 'M'}${x(index).toFixed(1)} ${y(point.value).toFixed(1)}`)
    open = true
  })
  return segments.join(' ')
})

const edgeDots = computed(() => {
  if (props.kind !== 'line' || known.value.length === 0) return []
  const indexed = props.points
    .map((point, index) => ({ point, index }))
    .filter(({ point }) => point.value !== null)
  const first = indexed[0]
  const last = indexed.at(-1)!
  return [first, last]
    .filter((item, position, all) => all.indexOf(item) === position)
    .map(({ point, index }) => ({ cx: x(index), cy: y(point.value!), date: point.date, value: point.value! }))
})

const fmt = (value: number): string =>
  value.toLocaleString('ru-RU', { maximumFractionDigits: props.digits })

const hovered = ref<number | null>(null)
const tip = computed(() => {
  if (hovered.value === null) return null
  const point = props.points[hovered.value]
  if (!point || point.value === null) return null
  return {
    left: `${(x(hovered.value) / W) * 100}%`,
    top: `${(y(point.value) / H) * 100}%`,
    date: point.date,
    text: `${fmt(point.value)} ${props.unit}`.trim(),
  }
})

function onMove(event: MouseEvent): void {
  const box = (event.currentTarget as SVGElement).getBoundingClientRect()
  const ratio = ((event.clientX - box.left) / box.width) * W
  const step = (W - PAD_L - PAD_R) / Math.max(props.points.length - 1, 1)
  const index = Math.round((ratio - PAD_L) / step)
  hovered.value = index >= 0 && index < props.points.length ? index : null
}
</script>

<template>
  <div class="chart">
    <p v-if="known.length === 0" class="chart__empty">Нет данных за этот период</p>

    <svg
      v-else
      class="chart__svg"
      :viewBox="`0 0 ${W} ${H}`"
      role="img"
      @mousemove="onMove"
      @mouseleave="hovered = null"
    >
      <!-- шкала: только границы, чтобы сетка не спорила с данными -->
      <line :x1="PAD_L" :y1="PAD_T" :x2="W - PAD_R" :y2="PAD_T" class="chart__grid" />
      <line
        :x1="PAD_L"
        :y1="H - PAD_B"
        :x2="W - PAD_R"
        :y2="H - PAD_B"
        class="chart__grid"
      />
      <text :x="PAD_L - 4" :y="PAD_T + 3" text-anchor="end" class="chart__axis">
        {{ fmt(scale.max) }}
      </text>
      <text :x="PAD_L - 4" :y="H - PAD_B" text-anchor="end" class="chart__axis">
        {{ fmt(scale.min) }}
      </text>

      <template v-if="reference !== null">
        <line
          :x1="PAD_L"
          :y1="y(reference)"
          :x2="W - PAD_R"
          :y2="y(reference)"
          class="chart__reference"
          vector-effect="non-scaling-stroke"
        />
        <text :x="W - PAD_R" :y="y(reference) - 3" text-anchor="end" class="chart__axis">
          {{ referenceLabel || t('chart.goal') }}
        </text>
      </template>

      <template v-if="kind === 'bars'">
        <rect
          v-for="bar in barGeometry.filter(Boolean)"
          :key="bar!.date"
          :x="bar!.x"
          :y="bar!.y"
          :width="bar!.width"
          :height="bar!.height"
          rx="2"
          class="chart__bar"
        />
      </template>
      <template v-else>
        <path :d="linePath" class="chart__line" vector-effect="non-scaling-stroke" />
        <circle
          v-for="dot in edgeDots"
          :key="dot.date"
          :cx="dot.cx"
          :cy="dot.cy"
          r="4"
          class="chart__dot"
        />
      </template>

      <text :x="PAD_L" :y="H - 4" class="chart__axis">{{ points[0]?.date }}</text>
      <text :x="W - PAD_R" :y="H - 4" text-anchor="end" class="chart__axis">
        {{ points.at(-1)?.date }}
      </text>
    </svg>

    <div v-if="tip" class="chart__tip" :style="{ left: tip.left, top: tip.top }">
      <strong>{{ tip.text }}</strong>
      <span class="tiny"> · {{ tip.date }}</span>
    </div>
  </div>
</template>
