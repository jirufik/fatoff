<script setup lang="ts">
import type { TableDoc } from '@fatoff/contracts'

/** Описание полей одной таблицы: что означает строка и что лежит в каждой колонке. */
defineProps<{ doc: TableDoc; open?: boolean }>()

const { t, pick } = useI18n()

/** В примечаниях встречается разметка `код` и **важное** — разворачиваем её. */
const rich = (text: string): string =>
  text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
</script>

<template>
  <details class="fields" :open="open">
    <summary>{{ t('fields.whatsInside') }}</summary>

    <p class="fields__row">
      {{ t('fields.oneRow', { row: pick(doc.row) }) }}
      <span v-if="doc.note" v-html="` ${rich(pick(doc.note))}`" />
    </p>

    <div class="table-wrap">
      <table class="data">
        <thead>
          <tr>
            <th>{{ t('fields.col.field') }}</th>
            <th>{{ t('fields.col.what') }}</th>
            <th>{{ t('fields.col.details') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="field in doc.fields" :key="field.name">
            <td class="mono">{{ field.name }}</td>
            <td>{{ pick(field.title) }}</td>
            <td style="white-space: normal" v-html="field.note ? rich(pick(field.note)) : '—'" />
          </tr>
        </tbody>
      </table>
    </div>

    <p v-if="doc.nutrients" class="tiny" style="margin-bottom: 0">
      {{ t('fields.plusNutrients', { scope: t(`nutrient.scope.${doc.nutrients}`) }) }}
      <NuxtLink to="/fields">{{ t('fields.plusLink') }}</NuxtLink>
    </p>
  </details>
</template>

<style scoped>
.fields {
  margin-top: 0.75rem;
  font-size: 0.85rem;
}
.fields summary {
  cursor: pointer;
  color: var(--accent);
  font-weight: 600;
}
.fields__row {
  color: var(--ink-2);
  margin: 0.5rem 0;
}
</style>
