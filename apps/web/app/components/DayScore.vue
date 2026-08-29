<script setup lang="ts">
import type { ScoreBreakdownDto } from '@fatoff/contracts'

/**
 * Оценка дня кольцом с числом внутри.
 *
 * Число обязательно: цвет кольца сам по себе ничего не сообщает тому, кто его
 * не различает, а разбор по составляющим лежит рядом — оценка без объяснения,
 * из чего она сложилась, ничем не лучше гадания.
 */
const props = withDefaults(
  defineProps<{ score: number | null; size?: number; breakdown?: ScoreBreakdownDto | null }>(),
  { size: 44, breakdown: null },
)

const radius = computed(() => props.size / 2 - 3)
const circumference = computed(() => 2 * Math.PI * radius.value)
const filled = computed(() => ((props.score ?? 0) / 100) * circumference.value)

const hint = computed(() =>
  props.score === null
    ? 'Оценка дня: данных нет'
    : `Оценка дня ${props.score} из 100 — из баланса энергии, белка, клетчатки, шагов, движения и сна`,
)

const tone = computed(() => {
  if (props.score === null) return 'none'
  if (props.score >= 75) return 'ok'
  if (props.score >= 50) return 'mid'
  return 'bad'
})
</script>

<template>
  <div
    class="score"
    :class="`score--${tone}`"
    :style="{ width: `${size}px`, height: `${size}px` }"
    :title="hint"
  >
    <svg :width="size" :height="size" aria-hidden="true">
      <circle
        class="score__track"
        :cx="size / 2"
        :cy="size / 2"
        :r="radius"
        fill="none"
        stroke-width="3"
      />
      <circle
        v-if="score !== null"
        class="score__fill"
        :cx="size / 2"
        :cy="size / 2"
        :r="radius"
        fill="none"
        stroke-width="3"
        stroke-linecap="round"
        :stroke-dasharray="`${filled} ${circumference}`"
        :transform="`rotate(-90 ${size / 2} ${size / 2})`"
      />
    </svg>
    <span class="score__value">{{ score === null ? '—' : score }}</span>
  </div>
</template>

<style scoped>
.score {
  position: relative;
  display: inline-grid;
  place-items: center;
  flex: none;
}
.score svg {
  position: absolute;
  inset: 0;
}
.score__track {
  stroke: var(--line);
}
.score__value {
  font-size: 0.85rem;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  line-height: 1;
}
.score--ok .score__fill {
  stroke: var(--ok);
}
.score--ok .score__value {
  color: var(--ok-ink);
}
.score--mid .score__fill {
  stroke: var(--accent);
}
.score--mid .score__value {
  color: var(--accent-ink);
}
.score--bad .score__fill {
  stroke: var(--bad);
}
.score--bad .score__value {
  color: var(--bad-ink);
}
.score--none .score__value {
  color: var(--ink-3);
}
</style>
