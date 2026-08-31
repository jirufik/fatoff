/**
 * Разбор доски задач: имена папок и поиск задачи.
 *
 * Статус задачи хранится в имени её папки (D-071), поэтому «прочитать доску» —
 * это разобрать имена. Вынесено отдельно, потому что этим пользуется и сама
 * доска, и оповещения: два разных разбора одного имени рано или поздно разошлись
 * бы, и статус в Telegram перестал бы совпадать со статусом на Drive.
 */
import { listFolder } from './drive-api.mjs';

/**
 * Имя папки задачи: `T-03 · Сортировка в «День целиком» · в работе`.
 *
 * Разделитель — «·» с пробелами: он не встречается в названиях задач, поэтому
 * разбор однозначен, а человеку читается как обычный текст.
 */
export const SEP = ' · ';

export const parseFolder = (name) => {
  const parts = name.split(SEP);
  if (parts.length < 3) return null;
  const status = parts[parts.length - 1];
  return { id: parts[0], title: parts.slice(1, -1).join(SEP), status };
};

export const folderName = ({ id, title, status }) => [id, title, status].join(SEP);

/** Папка задачи, её разобранное имя и документ внутри — всё, что нужно обоим. */
export async function findTask(tasksFolderId, id) {
  const folders = await listFolder(tasksFolderId);
  const folder = folders.find((item) => item.name.startsWith(`${id}${SEP}`));
  if (!folder) throw new Error(`задача ${id} на доске не найдена`);

  const inside = await listFolder(folder.id);
  const doc = inside.find((item) => item.mimeType === 'application/vnd.google-apps.document');
  return { folder, parsed: parseFolder(folder.name), doc: doc ?? null };
}

/** Ссылка на документ задачи — её и показывают человеку. */
export const docUrl = (doc) => (doc ? `https://docs.google.com/document/d/${doc.id}/edit` : '');
