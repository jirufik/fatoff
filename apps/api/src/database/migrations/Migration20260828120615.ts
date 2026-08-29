import { Migration } from '@mikro-orm/migrations';

export class Migration20260828120615 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table "export_file" add column "include_health" boolean not null default true;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "export_file" drop column "include_health";`);
  }

}
