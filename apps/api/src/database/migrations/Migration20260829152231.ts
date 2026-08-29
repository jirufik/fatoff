import { Migration } from '@mikro-orm/migrations';

export class Migration20260829152231 extends Migration {

  override async up(): Promise<void> {
    // откуда брать выгрузку Apple Health и когда её проверять
    this.addSql(
      `alter table "account" add column "drive_url" text null, ` +
        `add column "drive_daily_at" varchar(5) null, ` +
        `add column "drive_enabled" boolean not null default false;`,
    );

    // имя файла, как его назвал источник: внутреннее имя человеку ни о чём не говорит
    this.addSql(`alter table "health_import" add column "file_label" text null;`);

    // журнал проверок папки: самый частый исход — «файл тот же», и он должен быть виден
    this.addSql(
      `create table "drive_fetch" (` +
        `"id" uuid not null, "account_id" uuid not null, "status" text not null, ` +
        `"trigger" text not null, "file_id" text null, "file_name" text null, ` +
        `"size_bytes" bigint null, "md5" text null, ` +
        `"bytes_downloaded" bigint not null default 0, "import_id" uuid null, ` +
        `"error_code" text null, "error" text null, ` +
        `"started_at" timestamptz not null, "finished_at" timestamptz null, ` +
        `constraint "drive_fetch_pkey" primary key ("id"));`,
    );
    this.addSql(`create index "drive_fetch_account_id_index" on "drive_fetch" ("account_id");`);
    this.addSql(
      `alter table "drive_fetch" add constraint "drive_fetch_account_id_foreign" ` +
        `foreign key ("account_id") references "account" ("id") ` +
        `on update cascade on delete cascade;`,
    );
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "drive_fetch" cascade;`);
    this.addSql(`alter table "health_import" drop column "file_label";`);
    this.addSql(
      `alter table "account" drop column "drive_url", ` +
        `drop column "drive_daily_at", drop column "drive_enabled";`,
    );
  }

}
