#!/usr/bin/env node
/**
 * Оповещения о ходе задач в Telegram.
 *
 * Заказчик не сидит в терминале и не смотрит на доску. Ему важно знать четыре
 * вещи: работа началась, работа упёрлась в вопрос, работу можно посмотреть,
 * работа выкачена. Всё остальное — шум, а шум в общей группе быстро приучает
 * её не читать (D-076).
 *
 * Поэтому событий ровно четыре, и других команд у скрипта нет. Сообщение
 * короткое: что за задача, что произошло, куда смотреть. Подробности живут в
 * документе задачи — на него и ведёт ссылка.
 *
 *   node scripts/notify.mjs work   T-10
 *   node scripts/notify.mjs ask    T-10 «вопрос одной фразой»
 *   node scripts/notify.mjs review T-10 «что сделал одной строкой»
 *   node scripts/notify.mjs done   T-10
 *   node scripts/notify.mjs chat                — узнать номер группы
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { docUrl, findTask } from './board.mjs';
import { envValue } from './env.mjs';

/** Токен бота лежит рядом с ключом Google: в `secrets/`, мимо git. */
function token() {
  const file = envValue('TELEGRAM_BOT_FILE') || 'secrets/fatoff-tg-bot.json';
  const path = resolve(new URL('..', import.meta.url).pathname, file);
  const key = JSON.parse(readFileSync(path, 'utf8')).accessKey;
  if (!key) throw new Error(`в ${file} нет accessKey`);
  return key;
}

async function telegram(method, payload) {
  const response = await fetch(`https://api.telegram.org/bot${token()}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = await response.json();
  if (!body.ok) throw new Error(`Telegram: ${body.description ?? response.status}`);
  return body.result;
}

/**
 * Тексты событий.
 *
 * Пишем так, как сказали бы вслух: без «реализован функционал» и без списка
 * коммитов. Значок в начале нужен, чтобы событие узнавалось в ленте с одного
 * взгляда, а не читалось целиком.
 */
const EVENTS = {
  work: {
    mark: '🔧',
    lines: ({ note }) => [note ? `Взял в работу: ${note}` : 'Взял в работу.'],
  },
  ask: {
    mark: '❓',
    needsNote: 'вопрос',
    lines: ({ note }) => [`Нужен ваш ответ: ${note}`, 'Пока задача стоит.'],
  },
  review: {
    mark: '👀',
    needsNote: 'что сделал',
    lines: ({ note, dev }) => [
      note,
      dev ? `Посмотреть: ${dev}` : 'Контур не задан: см. DEV_URL в .env',
    ],
  },
  done: {
    mark: '✅',
    lines: ({ note, live }) => [
      note ? `Готово: ${note}` : 'Готово и выкачено.',
      live ? `Смотреть: ${live}` : '',
    ],
  },
};

async function main() {
  const [event, id, ...words] = process.argv.slice(2);
  const note = words.join(' ').trim();

  if (event === 'chat') {
    const updates = await telegram('getUpdates', {});
    const chats = new Map();
    for (const update of updates) {
      for (const key of ['message', 'my_chat_member', 'channel_post', 'edited_message']) {
        const chat = update[key]?.chat;
        if (chat) chats.set(chat.id, `${chat.type} · ${chat.title ?? chat.username ?? ''}`);
      }
    }
    if (chats.size === 0) {
      console.log(
        'Бот пока не видел ни одного обращения.\n' +
          'У ботов включён режим приватности: обычные сообщения группы до них не доходят.\n' +
          'Напишите в группе команду с упоминанием бота, например «/start@<имя-бота>», и повторите.',
      );
      return;
    }
    for (const [chatId, what] of chats) console.log(`TELEGRAM_CHAT_ID=${chatId}   # ${what}`);
    return;
  }

  const spec = EVENTS[event];
  if (!spec || !id) {
    console.log(readFileSync(new URL(import.meta.url), 'utf8').split('*/')[0].replace(/^#![^\n]*\n/, ''));
    process.exitCode = 1;
    return;
  }
  if (spec.needsNote && !note) throw new Error(`нужно: notify.mjs ${event} ${id} «${spec.needsNote}»`);

  const chatId = envValue('TELEGRAM_CHAT_ID');
  if (!chatId) throw new Error('TELEGRAM_CHAT_ID не задан в .env — узнать: node scripts/notify.mjs chat');

  const { parsed, doc } = await findTask(envValue('DRIVE_TASKS_FOLDER'), id);
  const lines = spec
    .lines({ note, dev: envValue('DEV_URL'), live: envValue('PUBLIC_URL') })
    .filter(Boolean);

  const url = docUrl(doc);
  const text = [
    `${spec.mark} ${parsed.id} · ${parsed.title}`,
    ...lines,
    url ? `Задача: ${url}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  await telegram('sendMessage', {
    chat_id: chatId,
    text,
    disable_web_page_preview: true,
  });
  console.log('отправлено:\n' + text);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
