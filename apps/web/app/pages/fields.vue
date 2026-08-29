<script setup lang="ts">
import { BROWSE_TABLES, EXPORT_TABLES, NUTRIENTS, READING_RULES } from '@fatoff/contracts'

const { t, pick } = useI18n()

/** Поиск идёт и по именам колонок, и по человеческим названиям. */
const search = ref('')

const matches = (haystack: string | null | undefined): boolean =>
  (haystack ?? '').toLowerCase().includes(search.value.trim().toLowerCase())

const filteredTables = computed(() => {
  if (!search.value.trim()) return EXPORT_TABLES
  return EXPORT_TABLES.map((doc) => ({
    ...doc,
    fields: doc.fields.filter(
      (field) => matches(field.name) || matches(pick(field.title)) || matches(pick(field.note)),
    ),
  })).filter((doc) => doc.fields.length > 0 || matches(doc.name) || matches(pick(doc.title)))
})

const filteredNutrients = computed(() => {
  if (!search.value.trim()) return NUTRIENTS
  return NUTRIENTS.filter(
    (nutrient) =>
      matches(nutrient.column) || matches(pick(nutrient.title)) || matches(nutrient.apiKey),
  )
})

const groups = computed(() => {
  const byGroup = new Map<string, typeof NUTRIENTS>()
  for (const nutrient of filteredNutrients.value) {
    byGroup.set(nutrient.group, [...(byGroup.get(nutrient.group) ?? []), nutrient])
  }
  return [...byGroup.entries()]
})

const rich = (text: string): string =>
  text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
</script>

<template>
  <div>
    <h1>{{ t('fields.title') }}</h1>
    <p class="lede">{{ t('fields.lede') }}</p>

    <h2>{{ t('fields.rules') }}</h2>
    <div class="card">
      <ul class="rules">
        <li v-for="(rule, index) in READING_RULES" :key="index" v-html="rich(pick(rule))" />
      </ul>
    </div>

    <label class="field" style="margin: 1.5rem 0 0.75rem">
      <span>{{ t('fields.search') }}</span>
      <input v-model="search" type="text" :placeholder="t('fields.search.hint')" />
    </label>

    <h2>{{ t('fields.export') }}</h2>
    <p class="muted" style="margin-top: -0.3rem">{{ t('fields.export.note') }}</p>

    <p v-if="filteredTables.length === 0" class="card muted">{{ t('fields.empty') }}</p>

    <div v-for="doc in filteredTables" :key="doc.name" class="card">
      <div class="row row--between row--wrap">
        <strong class="mono">{{ doc.name }}</strong>
        <span class="tiny">{{ pick(doc.title) }} · {{ t('fields.oneRow', { row: pick(doc.row) }) }}</span>
      </div>
      <p v-if="doc.note" class="tiny" style="margin: 0.4rem 0 0.6rem" v-html="rich(pick(doc.note))" />

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
      </p>
    </div>

    <h2>{{ t('fields.nutrients') }}</h2>
    <p class="muted" style="margin-top: -0.3rem">
      {{ t('fields.nutrients.note', { count: NUTRIENTS.length }) }}
    </p>

    <div v-for="[group, items] in groups" :key="group" class="card">
      <h3>{{ t(`nutrient.group.${group}`) }}</h3>
      <div class="table-wrap">
        <table class="data">
          <thead>
            <tr>
              <th>{{ t('fields.col.column') }}</th>
              <th>{{ t('fields.col.nutrient') }}</th>
              <th>{{ t('fields.col.unit') }}</th>
              <th>{{ t('fields.col.apiKey') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="nutrient in items" :key="nutrient.column">
              <td class="mono">{{ nutrient.column }}</td>
              <td>{{ pick(nutrient.title) }}</td>
              <td>{{ t(`nutrient.unit.${nutrient.unit}`) }}</td>
              <td class="mono tiny">{{ nutrient.apiKey }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <h2>{{ t('fields.browse') }}</h2>
    <p class="muted" style="margin-top: -0.3rem">{{ t('fields.browse.note') }}</p>

    <div v-for="doc in BROWSE_TABLES" :key="doc.name" class="card">
      <div class="row row--between row--wrap">
        <strong>{{ pick(doc.title) }}</strong>
        <span class="tiny">{{ t('fields.oneRow', { row: pick(doc.row) }) }}</span>
      </div>
      <p v-if="doc.note" class="tiny" style="margin: 0.4rem 0 0.6rem" v-html="rich(pick(doc.note))" />

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
    </div>
  </div>
</template>

<style scoped>
.rules {
  margin: 0;
  padding-left: 1.1rem;
  font-size: 0.9rem;
  color: var(--ink-2);
}
.rules li + li {
  margin-top: 0.5rem;
}
</style>
