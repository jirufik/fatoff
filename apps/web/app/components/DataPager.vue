<script setup lang="ts">
import { PAGE_SIZES } from '@fatoff/contracts'

const { t } = useI18n()

const props = defineProps<{
  page: number
  pageSize: number
  total: number
  loading?: boolean
}>()

const emit = defineEmits<{
  (event: 'update:page', value: number): void
  (event: 'update:pageSize', value: number): void
}>()

const pages = computed(() => Math.max(Math.ceil(props.total / props.pageSize), 1))
const first = computed(() => (props.total === 0 ? 0 : (props.page - 1) * props.pageSize + 1))
const last = computed(() => Math.min(props.page * props.pageSize, props.total))

const go = (page: number): void => {
  if (page >= 1 && page <= pages.value) emit('update:page', page)
}
</script>

<template>
  <div class="pager">
    <span class="pager__count mono">
      {{
        total === 0
          ? t('common.nothing')
          : t('pager.range', { first, last, total: total.toLocaleString('ru-RU') })
      }}
    </span>

    <span v-if="loading" class="spinner" />

    <div class="pager__buttons">
      <button class="btn btn--small" :disabled="page <= 1" @click="go(1)" :title="t('pager.first')">«</button>
      <button class="btn btn--small" :disabled="page <= 1" @click="go(page - 1)">{{ t('pager.prev') }}</button>
      <span class="pager__page mono">{{ page }} / {{ pages }}</span>
      <button class="btn btn--small" :disabled="page >= pages" @click="go(page + 1)">{{ t('pager.next') }}</button>
      <button class="btn btn--small" :disabled="page >= pages" @click="go(pages)" :title="t('pager.last')">»</button>
    </div>

    <select
      class="pager__size"
      :value="pageSize"
      @change="emit('update:pageSize', Number(($event.target as HTMLSelectElement).value))"
    >
      <option v-for="size in PAGE_SIZES" :key="size" :value="size">{{ t('pager.perPage', { size }) }}</option>
    </select>
  </div>
</template>

<style scoped>
.pager {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  flex-wrap: wrap;
  margin-top: 0.75rem;
}
.pager__count {
  font-size: 0.82rem;
  color: var(--ink-2);
  margin-right: auto;
  min-width: 0;
  overflow-wrap: anywhere;
}
.pager__buttons {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.3rem;
}
.pager__page {
  font-size: 0.82rem;
  color: var(--ink-2);
  /* на узком экране фиксированная ширина распирала строку сильнее, чем экономила */
  min-width: 0;
  text-align: center;
}
@media (min-width: 46rem) {
  .pager__page {
    min-width: 4rem;
  }
}
.pager__size {
  width: auto;
  min-height: 34px;
  font-size: 0.85rem;
}
</style>
