import { Entity, Index, ManyToOne, PrimaryKey, Property } from '@mikro-orm/core';
import { randomUUID } from 'node:crypto';

import { Account } from './account.entity';

export type DriveFetchStatus =
  /** Файл тот же, что в прошлый раз — разбирать нечего. */
  | 'same'
  /** Скачали и запустили загрузку. */
  | 'imported'
  /** В папке нет ничего похожего на выгрузку. */
  | 'empty'
  /** Нашли файл, но это не выгрузка Apple Health. */
  | 'rejected'
  /** Не дошли до файла вовсе: ключ, сеть, права. */
  | 'failed';

/**
 * Одна проверка папки Google Drive.
 *
 * Журнал нужен ровно затем, что самый частый исход — «ничего не делали»: файл
 * тот же. Без записи это неотличимо от «проверка не запускалась», и понять,
 * работает ли ежедневная проверка вообще, было бы нечем.
 */
@Entity({ tableName: 'drive_fetch' })
export class DriveFetch {
  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Index()
  @ManyToOne(() => Account, { deleteRule: 'cascade' })
  account!: Account;

  @Property({ type: 'text' })
  status!: DriveFetchStatus;

  /** Кто запустил: расписание или человек кнопкой. */
  @Property({ type: 'text' })
  trigger!: 'schedule' | 'manual';

  @Property({ type: 'text', nullable: true })
  fileId?: string | null;

  @Property({ type: 'text', nullable: true })
  fileName?: string | null;

  @Property({ type: 'bigint', nullable: true })
  sizeBytes?: number | null;

  /**
   * Контрольная сумма файла в Drive.
   *
   * По ней и решается, новый ли файл. Дата изменения для этого хуже: Drive
   * обновляет её и при переименовании, а перебирать два гигабайта ради нового
   * имени незачем.
   */
  @Property({ type: 'text', nullable: true })
  md5?: string | null;

  @Property({ type: 'bigint' })
  bytesDownloaded = 0;

  /** Запущенная загрузка Apple Health, если дошло до неё. */
  @Property({ type: 'uuid', nullable: true })
  importId?: string | null;

  /** Код отказа: фразу по нему соберёт интерфейс на своём языке (D-044). */
  @Property({ type: 'text', nullable: true })
  errorCode?: string | null;

  /** Исходный текст — только для неопознанной ошибки, которую не перечислить. */
  @Property({ type: 'text', nullable: true })
  error?: string | null;

  @Property({ type: 'timestamptz' })
  startedAt: Date = new Date();

  @Property({ type: 'timestamptz', nullable: true })
  finishedAt?: Date | null;
}
