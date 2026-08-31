#!/usr/bin/env node
/**
 * Доска задач на Google Drive.
 *
 * Замечания приходят в документ на Drive, оттуда становятся задачами, задачи
 * делаются в своих ветках, статус виден и заказчику, и любой сессии.
 *
 * Устройство продиктовано ограничением, а не вкусом: **сервисный аккаунт не
 * может владеть файлами** — его квота Drive равна нулю, и создание файла
 * возвращает 403 `storageQuotaExceeded`. Зато он свободно создаёт папки (они
 * ничего не весят) и правит файлы, которыми владеет человек. Отсюда разделение
 * (D-071):
 *
 *   • статус задачи   — в имени папки, папки заводит сервис;
 *   • текст задачи    — в документе внутри её папки;
 *   • общая картина   — в документе доски;
 *
 * документы создаёт человек, наполняет и переименовывает сервис.
 *
 * Запуск:
 *   node scripts/task-board.mjs notes            — замечания заказчика
 *   node scripts/task-board.mjs list             — доска: задачи и статусы
 *   node scripts/task-board.mjs status T-03 «в работе»
 *   node scripts/task-board.mjs push <файл>      — переписать документ доски
 *   node scripts/task-board.mjs pull             — прочитать документ доски
 *   node scripts/task-board.mjs task T-03        — прочитать документ задачи
 *   node scripts/task-board.mjs task T-03 <файл> — переписать документ задачи
 */
import { readFileSync } from 'node:fs';

import { ensureFolder, listFolder, readDoc, rename, writeDoc } from './drive-api.mjs';
import { envValue } from './env.mjs';
import { SEP, folderName, parseFolder } from './board.mjs';

/** Статусы. Порядок — это и есть жизненный путь задачи. */
export const STATUSES = ['ожидает', 'в работе', 'на проверке', 'готово', 'отложена', 'вопрос'];


/** Настройки берутся из `.env`: идентификаторы личные и в git не едут. */
function env() {
  return {
    tasks: envValue('DRIVE_TASKS_FOLDER'),
    notes: envValue('DRIVE_NOTES_DOC'),
    board: envValue('DRIVE_TASKS_DOC'),
    root: envValue('DRIVE_FATOFF_FOLDER'),
  };
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const cfg = env();

  if (command === 'notes') {
    if (!cfg.notes) throw new Error('DRIVE_NOTES_DOC не задан в .env');
    process.stdout.write(await readDoc(cfg.notes));
    return;
  }

  if (command === 'list') {
    const folders = await listFolder(cfg.tasks);
    const tasks = folders
      .filter((f) => f.mimeType === 'application/vnd.google-apps.folder')
      .map((f) => ({ ...parseFolder(f.name), driveId: f.id }))
      .filter((t) => t.id);

    const width = Math.max(...tasks.map((t) => t.title.length), 10);
    for (const task of tasks) {
      console.log(`${task.id}  ${task.title.padEnd(width)}  ${task.status}`);
    }
    const done = tasks.filter((t) => t.status === 'готово').length;
    console.log(`\nвсего ${tasks.length}, готово ${done}`);
    return;
  }

  if (command === 'status') {
    const [id, status] = rest;
    if (!id || !status) throw new Error('нужно: status <T-xx> <статус>');
    if (!STATUSES.includes(status)) {
      throw new Error(`статус «${status}» не из списка: ${STATUSES.join(', ')}`);
    }

    const folders = await listFolder(cfg.tasks);
    const found = folders.find((f) => f.name.startsWith(`${id}${SEP}`));
    if (!found) throw new Error(`задача ${id} на доске не найдена`);

    const parsed = parseFolder(found.name);
    if (parsed.status === status) {
      console.log(`${id}: и так «${status}»`);
      return;
    }
    await rename(found.id, folderName({ ...parsed, status }));
    console.log(`${id}: «${parsed.status}» → «${status}»`);
    return;
  }

  if (command === 'add') {
    const [id, ...title] = rest;
    if (!id || title.length === 0) throw new Error('нужно: add <T-xx> <название>');
    const folder = await ensureFolder(
      folderName({ id, title: title.join(' '), status: 'ожидает' }),
      cfg.tasks,
    );
    console.log('заведена:', folder.name);
    return;
  }

  /**
   * Документ задачи лежит в её папке. Создать его сервис не может — только
   * найти и переписать, поэтому отсутствие документа не ошибка инструмента,
   * а повод попросить человека его завести.
   */
  if (command === 'task') {
    const [id, file] = rest;
    if (!id) throw new Error('нужно: task <T-xx> [файл]');

    const folders = await listFolder(cfg.tasks);
    const folder = folders.find((f) => f.name.startsWith(`${id}${SEP}`));
    if (!folder) throw new Error(`задача ${id} на доске не найдена`);

    const inside = await listFolder(folder.id);
    const doc = inside.find((f) => f.mimeType === 'application/vnd.google-apps.document');
    if (!doc) {
      throw new Error(
        `в папке ${id} нет документа. Создать его должен человек: ` +
          `сервисный аккаунт файлами владеть не может (D-071)`,
      );
    }

    if (!file) {
      process.stdout.write(await readDoc(doc.id));
      return;
    }
    // .html Google разберёт и сделает настоящий документ с заголовками и
    // таблицами; всё остальное уедет простым текстом
    const mime = file.endsWith('.html') ? 'text/html' : 'text/plain';
    const result = await writeDoc(doc.id, readFileSync(file, 'utf8'), mime);

    // имя документа держим равным имени папки без статуса: статус живёт в папке
    // и меняется, а имя документа — нет
    const want = folder.name.split(SEP).slice(0, -1).join(SEP);
    if (result.name !== want) await rename(doc.id, want);

    console.log('записано:', want, result.modifiedTime);
    return;
  }

  if (command === 'pull') {
    if (!cfg.board) throw new Error('DRIVE_TASKS_DOC не задан: документ задач создаёт человек');
    process.stdout.write(await readDoc(cfg.board));
    return;
  }

  if (command === 'push') {
    if (!cfg.board) throw new Error('DRIVE_TASKS_DOC не задан: документ задач создаёт человек');
    const [file] = rest;
    if (!file) throw new Error('нужно: push <файл с текстом доски>');
    const result = await writeDoc(cfg.board, readFileSync(file, 'utf8'));
    console.log('записано:', result.name, result.modifiedTime);
    return;
  }

  console.log(readFileSync(new URL(import.meta.url), 'utf8').split('*/')[0].replace(/^#![^\n]*\n/, ''));
  process.exitCode = 1;
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
