<script setup lang="ts">
/**
 * Шапка страницы: возврат, заголовок и строка ссылок под ним.
 *
 * Кнопка возврата ведёт в историю браузера, а если истории нет — на страницу
 * аккаунта: открытая по ссылке страница не должна оставлять человека без выхода.
 */
const props = defineProps<{
  title: string
  back?: string
  /** Заголовок — не имя, а служебная строка (почта): мельче и в одну строку. */
  faint?: boolean
}>()

const router = useRouter()

function goBack(): void {
  if (window.history.length > 1) router.back()
  else if (props.back) void router.push(props.back)
}
</script>

<template>
  <header class="head">
    <div class="row">
      <button class="back" type="button" title="Назад" aria-label="Назад" @click="goBack">
        <AppIcon name="back" :size="18" />
      </button>
      <h1 :class="{ 'head__faint': faint }" :title="title">{{ title }}</h1>
      <slot name="title-extra" />
    </div>
    <p class="lede"><slot /></p>
  </header>
</template>

<style scoped>
.head {
  margin-bottom: 1.25rem;
}
.head .row {
  gap: 0.6rem;
  margin-bottom: 0.2rem;
  min-width: 0;
}
.head h1 {
  margin: 0;
  /* заголовком бывает почта: без переноса она раздвигает страницу, и телефон
     показывает её уменьшенной вместе со всем остальным */
  min-width: 0;
  overflow-wrap: anywhere;
}
/*
 * Аккаунт без имени показывает почту. Она не имя: набрана мелко, в одну строку
 * и обрезается многоточием — иначе служебная строка длиной в полстроки кода
 * занимает всё место, отведённое заголовку.
 */
.head h1.head__faint {
  font-size: 1.05rem;
  font-family: var(--font-mono);
  font-weight: 500;
  color: var(--ink-2);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.back {
  display: inline-grid;
  place-items: center;
  width: 2.1rem;
  height: 2.1rem;
  flex: none;
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  background: var(--surface);
  color: var(--ink-2);
  cursor: pointer;
  transition: background 0.15s, color 0.15s, border-color 0.15s;
}
.back:hover {
  background: var(--sunk);
  color: var(--ink);
  border-color: color-mix(in oklab, var(--accent) 35%, var(--line));
}
.lede {
  margin: 0;
}
</style>
