import { Migration } from '@mikro-orm/migrations';

export class Migration20260830071500 extends Migration {

  /**
   * Аккаунтам, которые синхронизировались ночью, ставится их прежний час.
   *
   * Общее расписание `SYNC_CRON` было `0 3 * * *` и вело все включённые
   * аккаунты. Оно убрано (D-063), а личное время у них пустое — без переноса
   * синхронизация просто перестала бы запускаться, и заметили бы это не сразу,
   * а по устаревшим данным через несколько дней.
   *
   * Трогаются только те, у кого время ещё не задано: осознанный выбор человека
   * миграция перебивать не должна.
   */
  override async up(): Promise<void> {
    this.addSql(
      `update "account" set "sync_daily_at" = '03:00' ` +
        `where "sync_enabled" = true and "sync_daily_at" is null;`,
    );
  }

  override async down(): Promise<void> {
    this.addSql(`update "account" set "sync_daily_at" = null where "sync_daily_at" = '03:00';`);
  }

}
