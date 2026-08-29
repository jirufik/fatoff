<script setup lang="ts">
/**
 * КБЖУ одной строкой.
 *
 * Значки — эмодзи, а не свои контуры. Нарисованный контур яйца в двенадцать
 * пикселей неотличим от контура капли, и человек всё равно ищет подпись; эмодзи
 * узнаётся без обучения, потому что его уже видели тысячу раз. Тем же приёмом
 * сделаны аллергены в dynamic-competitor.
 *
 * Буква и цвет остаются: эмодзи может не отрисоваться, а различать величины
 * всё равно надо.
 */
withDefaults(
  defineProps<{
    protein?: number | null
    carbs?: number | null
    fat?: number | null
    fiber?: number | null
    digits?: number
    compact?: boolean
  }>(),
  { protein: null, carbs: null, fat: null, fiber: null, digits: 0, compact: false },
)

const { t } = useI18n()

const MACROS = [
  { key: 'protein', mark: '🥩' },
  { key: 'carbs', mark: '🍞' },
  { key: 'fat', mark: '🧈' },
  { key: 'fiber', mark: '🥦' },
] as const

const num = (value: number | null | undefined, digits: number): string =>
  value === null || value === undefined
    ? '—'
    : value.toLocaleString('ru-RU', { maximumFractionDigits: digits })
</script>

<template>
  <span class="macros" :class="{ 'macros--compact': compact }">
    <span
      v-for="macro in MACROS"
      :key="macro.key"
      class="macro"
      :class="`macro--${macro.key}`"
      :title="`${t(`macro.${macro.key}`)}, ${t('common.gram')}`"
    >
      <span class="mark" aria-hidden="true">{{ macro.mark }}</span>
      <span class="letter">{{ t(`macro.${macro.key}.letter`) }}</span>
      <span class="value">{{ num($props[macro.key], digits) }}</span>
    </span>
  </span>
</template>

<style scoped>
.macros {
  display: inline-flex;
  flex-wrap: wrap;
  gap: 0.15rem 0.55rem;
  font-family: var(--font-mono);
  font-size: 0.74rem;
  font-variant-numeric: tabular-nums;
  line-height: 1.5;
}
.macros--compact {
  font-size: 0.7rem;
  gap: 0.1rem 0.4rem;
}
.macro {
  display: inline-flex;
  align-items: center;
  gap: 0.22rem;
  white-space: nowrap;
}
.mark {
  font-size: 0.95em;
  line-height: 1;
}
.letter {
  color: currentColor;
  font-weight: 600;
}
.value {
  color: var(--ink-2);
  font-weight: 500;
}

.macro--protein {
  color: var(--accent);
}
.macro--carbs {
  color: var(--accent-3);
}
.macro--fat {
  color: var(--accent-2);
}
.macro--fiber {
  color: var(--ok);
}
</style>
