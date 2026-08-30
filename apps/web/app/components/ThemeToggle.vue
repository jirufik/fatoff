<script setup lang="ts">
import { PALETTES } from '~/composables/useTheme'

/**
 * Язык, свет и гамма — строками выпадающего меню шапки.
 *
 * Раньше это были три кнопки-иконки в служебной полосе, и гаммы открывались
 * своим списком. Полоса теперь одна, всё служебное собрано под шестерёнкой, и
 * заводить внутри меню ещё одно меню незачем: строки те же, что у соседей
 * (D-067).
 */
const { theme, palette, cycle, choose } = useTheme()
const { locale, apply: applyLocale, t } = useI18n()

/** Языков два, поэтому переключатель — кнопка, а не список. */
function toggleLocale(): void {
  applyLocale(locale.value === 'ru' ? 'en' : 'ru')
}

const themeIcon = computed(() => ({ system: '◐', light: '☀', dark: '☾' })[theme.value])
const themeName = computed(
  () => ({ system: t('theme.system'), light: t('theme.light'), dark: t('theme.dark') })[theme.value],
)
</script>

<template>
  <!-- `display: contents`: строки встают в поток меню, а не отдельной коробкой -->
  <div class="rows">
    <button class="row-item" type="button" @click="toggleLocale">
      <span class="grow">{{ t('nav.language') }}</span>
      <span class="mark">{{ locale === 'ru' ? 'RU' : 'EN' }}</span>
    </button>
    <button class="row-item" type="button" @click="cycle">
      <span class="grow">{{ t('nav.theme') }}</span>
      <span class="mark">{{ themeIcon }} {{ themeName }}</span>
    </button>
    <button
      v-for="item in PALETTES"
      :key="item.key"
      class="row-item"
      :class="{ 'row-item--on': palette === item.key }"
      type="button"
      @click="choose(item.key)"
    >
      <span class="swatch" :data-palette="item.key"><i /><i /><i /></span>
      <span class="grow">{{ item.title }}</span>
      <span v-if="palette === item.key" class="mark">✓</span>
    </button>
  </div>
</template>

<style scoped>
.rows {
  display: contents;
}
.row-item {
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
  cursor: pointer;
}
.row-item:hover {
  background: var(--sunk);
  color: var(--ink);
}
.row-item--on {
  background: var(--accent-bg);
  color: var(--accent-ink);
}
.row-item .grow {
  flex: 1;
}
.mark {
  font-family: var(--font-mono);
  font-size: 0.72rem;
  color: var(--ink-3);
}

/*
 * Образец гаммы: три её опорных цвета. Атрибут data-palette на самом образце
 * подхватывает те же переменные, что и вся страница, — отдельного списка
 * цветов для превью не заводится.
 */
.swatch {
  display: inline-flex;
  gap: 2px;
  flex: none;
  padding: 3px;
  border-radius: var(--radius-xs);
  background: var(--surface);
  border: 1px solid var(--line);
}
.swatch i {
  width: 6px;
  height: 14px;
  border-radius: 2px;
}
.swatch i:nth-child(1) {
  background: var(--accent);
}
.swatch i:nth-child(2) {
  background: var(--accent-2);
}
.swatch i:nth-child(3) {
  background: var(--ok);
}
</style>
