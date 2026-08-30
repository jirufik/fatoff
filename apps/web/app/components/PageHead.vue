<script setup lang="ts">
/**
 * Шапка страницы: возврат, заголовок и строка ссылок под ним.
 *
 * Кнопка возврата ведёт в историю браузера, а если истории нет — на страницу
 * аккаунта: открытая по ссылке страница не должна оставлять человека без выхода.
 */
/**
 * Шапка страницы: заголовок и строка пояснения под ним.
 *
 * Кнопки возврата здесь нет намеренно. Пока навигация пряталась в двух полосах,
 * она помогала; теперь раздел виден в меню всегда, и кнопка только съедала
 * место (D-067). Свойство `back` осталось, чтобы страницы не переписывать
 * разом, но ни на что не влияет.
 */
defineProps<{
  title: string
  back?: string
  /** Заголовок — не имя, а служебная строка (почта): мельче и в одну строку. */
  faint?: boolean
}>()
</script>

<template>
  <header class="head">
    <div class="row">
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
.lede {
  margin: 0;
}
</style>
