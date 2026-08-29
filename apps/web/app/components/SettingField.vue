<script setup lang="ts">
import type { SettingSpec } from '@fatoff/contracts'

/**
 * Одна настройка генератора: заголовок, значение, описание.
 *
 * Разметка строится по описанию из справочника, а не пишется руками под каждую
 * настройку. Так объяснение и применение не разъезжаются: и то и другое читает
 * один и тот же список, приходящий с сервера.
 */
const props = defineProps<{ spec: SettingSpec; value: number | boolean | null }>()
const { t, pick } = useI18n()
const emit = defineEmits<{ (event: 'update', value: number | boolean | null): void }>()

/*
 * Идентификатор поля свой у каждого появления, а не по ключу настройки: одна и
 * та же настройка показывается и в основных, и внутри своей группы, а два
 * одинаковых `id` на странице — невалидная разметка, из-за которой подпись
 * ведёт не туда.
 */
const fieldId = useId()

/** Значение вне рекомендованного участка — не ошибка, но сказать об этом стоит. */
const offRecommendation = computed(() => {
  const range = props.spec.recommended
  if (!range || typeof props.value !== 'number') return false
  return props.value < range[0] || props.value > range[1]
})

const isDefault = computed(() => props.value === props.spec.default)

function onNumber(event: Event): void {
  const raw = (event.target as HTMLInputElement).value
  emit('update', raw === '' ? null : Number(raw))
}
</script>

<template>
  <div class="setting">
    <div class="setting__row">
      <label class="setting__label" :for="fieldId">
        {{ pick(spec.title) }}
        <span v-if="spec.unit" class="tiny muted">, {{ pick(spec.unit) }}</span>
      </label>

      <label v-if="spec.kind === 'toggle'" class="check setting__control">
        <input
          :id="fieldId"
          :data-setting="spec.key"
          type="checkbox"
          :checked="value === true"
          @change="emit('update', ($event.target as HTMLInputElement).checked)"
        />
        <span>{{ value ? t('setting.on') : t('setting.off') }}</span>
      </label>

      <input
        v-else
        :id="fieldId"
        :data-setting="spec.key"
        class="setting__control"
        type="number"
        :min="spec.min"
        :max="spec.max"
        :step="spec.step"
        :placeholder="spec.default === null ? t('setting.byFormula') : String(spec.default)"
        :value="value === null ? '' : value"
        @input="onNumber"
      />
    </div>

    <p class="tiny muted setting__note">{{ pick(spec.description) }}</p>

    <p v-if="spec.source" class="tiny setting__source">
      <a v-if="spec.sourceUrl" :href="spec.sourceUrl" target="_blank" rel="noopener noreferrer">
        {{ pick(spec.source) }}<AppIcon name="external" :size="11" />
      </a>
      <template v-else>{{ pick(spec.source) }}</template>
    </p>

    <p v-if="offRecommendation" class="tiny setting__warn">
      {{
        t('setting.recommended', {
          low: spec.recommended![0],
          high: spec.recommended![1],
          unit: spec.unit ? pick(spec.unit) : '',
        })
      }}
    </p>

    <button
      v-if="!isDefault"
      class="btn btn--small setting__reset"
      type="button"
      @click="emit('update', spec.default)"
    >
      {{ t('setting.reset', { value: spec.default === null ? t('setting.byFormula') : spec.default }) }}
    </button>
  </div>
</template>

<style scoped>
.setting {
  padding: 0.6rem 0;
  border-bottom: 1px solid var(--line-soft);
}
.setting:last-child {
  border-bottom: none;
}
.setting__row {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  justify-content: space-between;
}
.setting__label {
  font-size: 0.9rem;
  font-weight: 600;
}
.setting__control {
  width: 9rem;
  flex: none;
}
.setting__note {
  margin: 0.25rem 0 0;
  max-width: 46rem;
}
.setting__source {
  margin: 0.25rem 0 0;
  color: var(--ink-3);
}
/* ссылка на источник не должна кричать: она подтверждение, а не действие */
.setting__source a {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  color: var(--ink-3);
  text-decoration: none;
  border-bottom: 1px dashed color-mix(in oklab, var(--ink-3) 55%, transparent);
}
.setting__source a:hover {
  color: var(--accent-ink);
  border-bottom-color: currentColor;
}
.setting__source a svg {
  opacity: 0.7;
}
.setting__warn {
  margin: 0.2rem 0 0;
  color: var(--note-ink);
}
.setting__reset {
  margin-top: 0.35rem;
}
</style>
