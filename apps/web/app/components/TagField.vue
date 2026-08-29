<script setup lang="ts">
/**
 * Выбор меток: заведённые — кнопками, новая — полем.
 *
 * Ввод через запятую выглядел просто, но требовал помнить, как метка называлась
 * в прошлый раз: «разгон» и «Разгон » превращались в две. Здесь заведённые
 * метки видно сразу, и новая заводится только осознанно.
 */
const model = defineModel<string[]>({ required: true })

const props = defineProps<{
  /** Уже заведённые метки аккаунта с числом планов. */
  known?: Array<{ tag: string; count: number }>
  id?: string
}>()

const { t } = useI18n()
const draft = ref('')
const fieldId = props.id ?? useId()

/** Метки приводятся так же, как на сервере, — иначе выбор «не находит» своё. */
const normalize = (value: string): string => value.trim().toLowerCase().slice(0, 40)

const suggestions = computed(() =>
  (props.known ?? []).filter((entry) => !model.value.includes(entry.tag)),
)

function toggle(tag: string): void {
  const at = model.value.indexOf(tag)
  model.value = at >= 0 ? model.value.toSpliced(at, 1) : [...model.value, tag]
}

function add(): void {
  const tag = normalize(draft.value)
  if (!tag) return
  if (!model.value.includes(tag)) model.value = [...model.value, tag]
  draft.value = ''
}
</script>

<template>
  <div class="tags">
    <div v-if="model.length > 0" class="tags__row">
      <button
        v-for="tag in model"
        :key="tag"
        class="tag tag--on"
        type="button"
        :title="t('plans.tag.remove')"
        @click="toggle(tag)"
      >
        #{{ tag }}
        <AppIcon name="close" :size="11" />
      </button>
    </div>

    <div class="tags__add">
      <input
        :id="fieldId"
        v-model="draft"
        type="text"
        maxlength="40"
        :placeholder="t('plans.tag.new')"
        @keydown.enter.prevent="add"
      />
      <button class="btn btn--small" type="button" :disabled="!draft.trim()" @click="add">
        <AppIcon name="plus" :size="12" /> {{ t('plans.tag.add') }}
      </button>
    </div>

    <div v-if="suggestions.length > 0" class="tags__row">
      <span class="tiny muted">{{ t('plans.tag.known') }}</span>
      <button
        v-for="entry in suggestions"
        :key="entry.tag"
        class="tag"
        type="button"
        @click="toggle(entry.tag)"
      >
        #{{ entry.tag }}
        <span class="tag__count">{{ entry.count }}</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.tags {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  min-width: 0;
}
.tags__row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.3rem;
}
.tags__add {
  display: flex;
  gap: 0.35rem;
}
.tags__add input {
  flex: 1 1 8rem;
  min-width: 0;
}

.tag {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  min-height: 30px;
  padding: 0 0.6rem;
  border: 1px solid var(--line);
  border-radius: 999px;
  background: var(--surface);
  color: var(--ink-2);
  font: inherit;
  font-size: 0.8rem;
  cursor: pointer;
}
.tag:hover {
  border-color: color-mix(in oklab, var(--accent) 45%, var(--line));
  color: var(--ink);
}
.tag--on {
  border-color: var(--accent);
  background: var(--accent-bg);
  color: var(--accent-ink);
}
.tag__count {
  font-family: var(--font-mono);
  font-size: 0.7rem;
  color: var(--ink-3);
}
</style>
