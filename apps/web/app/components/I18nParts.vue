<script setup lang="ts">
/**
 * Фраза из словаря, внутрь которой встроена разметка.
 *
 * Иногда посреди предложения стоит ссылка или `<code>`, а порядок слов в двух
 * языках разный — «нажать F12» и «press F12» ещё совпадают, а вот куда встанет
 * ссылка, заранее не известно. Класть теги в словарь и печатать их через
 * `v-html` нельзя: это ровно тот путь, которым однажды въезжает чужая разметка.
 *
 * Поэтому в словаре остаются подстановки `{link}`, а сюда передаются
 * одноимённые слоты. Строка режется по подстановкам, текст выводится как текст,
 * на месте подстановок рисуются слоты.
 */
const props = defineProps<{ text: string }>()

/** Куски строки: `text` — обычный текст, `slot` — имя подстановки. */
const parts = computed(() => {
  const found: Array<{ kind: 'text' | 'slot'; value: string }> = []
  let at = 0
  for (const match of props.text.matchAll(/\{(\w+)\}/g)) {
    if (match.index > at) found.push({ kind: 'text', value: props.text.slice(at, match.index) })
    found.push({ kind: 'slot', value: match[1] })
    at = match.index + match[0].length
  }
  if (at < props.text.length) found.push({ kind: 'text', value: props.text.slice(at) })
  return found
})
</script>

<template>
  <span>
    <template v-for="(part, index) in parts" :key="index">
      <template v-if="part.kind === 'text'">{{ part.value }}</template>
      <slot v-else :name="part.value" />
    </template>
  </span>
</template>
