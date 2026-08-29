<script setup lang="ts">
import { PALETTES } from '~/composables/useTheme'

/**
 * Свет и гамма — две отдельные кнопки.
 *
 * Первая перебирает системную, светлую и тёмную; вторая открывает список
 * палитр. Переключение мгновенное и на всю страницу — то, ради чего у Omarchy
 * смена темы вообще вынесена наружу.
 */
const { theme, palette, cycle, choose } = useTheme()
const { locale, apply: applyLocale, t } = useI18n()
const open = ref(false)

/** Языков два, поэтому переключатель — кнопка, а не список. */
function toggleLocale(): void {
  applyLocale(locale.value === 'ru' ? 'en' : 'ru')
}

const themeTitle = computed(
  () =>
    ({ system: 'Тема: как в системе', light: 'Тема: светлая', dark: 'Тема: тёмная' })[theme.value],
)
const themeIcon = computed(() => ({ system: '◐', light: '☀', dark: '☾' })[theme.value])

function pick(key: (typeof PALETTES)[number]['key']): void {
  choose(key)
  open.value = false
}
</script>

<template>
  <div class="controls">
    <button
      class="icon-btn icon-btn--text"
      :title="t('nav.language')"
      :aria-label="t('nav.language')"
      @click="toggleLocale"
    >
      {{ locale === 'ru' ? 'RU' : 'EN' }}
    </button>
    <button class="icon-btn" :title="themeTitle" :aria-label="themeTitle" @click="cycle">
      {{ themeIcon }}
    </button>

    <div class="picker">
      <button
        class="icon-btn"
        title="Цветовая гамма"
        aria-label="Цветовая гамма"
        :aria-expanded="open"
        @click="open = !open"
      >
        <span class="dot" />
      </button>

      <template v-if="open">
        <div class="scrim" @click="open = false" />
        <div class="menu">
          <p class="menu__title">Гамма</p>
          <button
            v-for="item in PALETTES"
            :key="item.key"
            class="menu__item"
            :class="{ 'menu__item--on': palette === item.key }"
            type="button"
            @click="pick(item.key)"
          >
            <span class="swatch" :data-palette="item.key">
              <i /><i /><i />
            </span>
            <span class="grow">
              <span class="menu__name">{{ item.title }}</span>
              <span class="tiny">{{ item.note }}</span>
            </span>
            <span v-if="palette === item.key" class="menu__check">✓</span>
          </button>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.controls {
  display: flex;
  gap: 0.2rem;
  align-items: center;
}

.icon-btn {
  display: inline-grid;
  place-items: center;
  width: 2rem;
  height: 2rem;
  border: none;
  border-radius: var(--radius-xs);
  background: none;
  color: var(--ink-2);
  font-size: 0.9rem;
  line-height: 1;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}
.icon-btn--text {
  width: auto;
  padding: 0 0.45rem;
  font-family: var(--font-mono);
  font-size: 0.72rem;
  font-weight: 600;
}
.icon-btn:hover {
  background: var(--sunk);
  color: var(--ink);
}

.dot {
  width: 0.85rem;
  height: 0.85rem;
  border-radius: 50%;
  background: linear-gradient(135deg, var(--accent), var(--accent-2));
}

.picker {
  position: relative;
}
.scrim {
  position: fixed;
  inset: 0;
  z-index: 20;
}
.menu {
  position: absolute;
  top: calc(100% + 0.4rem);
  right: 0;
  z-index: 21;
  width: 17rem;
  padding: 0.35rem;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  box-shadow: var(--shadow-lift);
}
.menu__title {
  font-family: var(--font-mono);
  font-size: 0.68rem;
  color: var(--ink-3);
  margin: 0.25rem 0.5rem 0.35rem;
}
.menu__item {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  width: 100%;
  padding: 0.4rem 0.5rem;
  border: none;
  border-radius: var(--radius-xs);
  background: none;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.menu__item:hover {
  background: var(--sunk);
}
.menu__item--on {
  background: var(--accent-bg);
}
.menu__name {
  display: block;
  font-size: 0.85rem;
  font-weight: 550;
}
.menu__item .grow {
  display: block;
}
.menu__check {
  color: var(--accent-ink);
  font-size: 0.8rem;
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
