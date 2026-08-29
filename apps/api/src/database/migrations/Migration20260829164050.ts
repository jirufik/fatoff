import { Migration } from '@mikro-orm/migrations';

export class Migration20260829164050 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table "account" add column "sync_daily_at" varchar(5) null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "account" drop column "sync_daily_at";`);
  }

}
