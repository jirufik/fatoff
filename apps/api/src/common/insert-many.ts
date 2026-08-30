import type { EntityManager } from '@mikro-orm/postgresql';
import { randomUUID } from 'node:crypto';

/** Пакет вставки. Больше — упираемся в размер запроса, меньше — в накладные расходы. */
const BATCH = 1000;

/**
 * Вставка пачками: сотни тысяч строк по одной — это минуты вместо секунд.
 *
 * Ключ проставляется здесь: `insertMany` не выполняет инициализатор свойства и
 * без явного `id` упирается в not-null. Та же грабля, что и у `upsert`.
 */
export async function insertMany<T extends object>(
  em: EntityManager,
  entity: new () => T,
  rows: Array<Record<string, unknown>>,
): Promise<void> {
  for (let at = 0; at < rows.length; at += BATCH) {
    const chunk = rows.slice(at, at + BATCH).map((row) => ({ id: randomUUID(), ...row }));
    if (chunk.length > 0) await em.insertMany(entity, chunk as never);
  }
}
