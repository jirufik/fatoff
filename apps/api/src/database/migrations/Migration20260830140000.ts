import { Migration } from '@mikro-orm/migrations';

export class Migration20260830140000 extends Migration {

  /**
   * Признак демо-аккаунта.
   *
   * Значение по умолчанию — `false`: все существующие аккаунты настоящие, и
   * интерфейс не должен вдруг перестать предлагать им синхронизацию (D-068).
   */
  override async up(): Promise<void> {
    this.addSql(
      `alter table "account" add column "is_demo" boolean not null default false;`,
    );
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "account" drop column "is_demo";`);
  }

}
