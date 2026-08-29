import { Migration } from '@mikro-orm/migrations';

export class Migration20260828073214 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table "account" ("id" uuid not null, "email" text not null, "label" text null, "password_enc" text not null, "access_token_enc" text null, "refresh_token_enc" text null, "token_expires_at" timestamptz null, "registration_date" varchar(10) null, "profile" jsonb null, "sync_enabled" boolean not null default true, "last_sync_at" timestamptz null, "last_sync_status" text not null default 'never', "created_at" timestamptz not null, "updated_at" timestamptz not null, constraint "account_pkey" primary key ("id"));`);
    this.addSql(`create index "account_email_index" on "account" ("email");`);
    this.addSql(`alter table "account" add constraint "account_email_unique" unique ("email");`);

    this.addSql(`create table "account_snapshot" ("id" uuid not null, "account_id" uuid not null, "kind" text not null, "payload" jsonb not null, "fetched_at" timestamptz not null, constraint "account_snapshot_pkey" primary key ("id"));`);
    this.addSql(`alter table "account_snapshot" add constraint "account_snapshot_account_id_kind_unique" unique ("account_id", "kind");`);

    this.addSql(`create table "body_value" ("id" uuid not null, "account_id" uuid not null, "kind" text not null, "logged_at" varchar(19) not null, "date" varchar(10) not null, "value" double precision not null default 0, constraint "body_value_pkey" primary key ("id"));`);
    this.addSql(`create index "body_value_account_id_index" on "body_value" ("account_id");`);
    this.addSql(`create index "body_value_date_index" on "body_value" ("date");`);
    this.addSql(`alter table "body_value" add constraint "body_value_account_id_kind_logged_at_unique" unique ("account_id", "kind", "logged_at");`);

    this.addSql(`create table "daily_exercise" ("id" uuid not null, "account_id" uuid not null, "date" varchar(10) not null, "steps" double precision not null default 0, "duration" double precision not null default 0, "energy" double precision not null default 0, "fetched_at" timestamptz not null, constraint "daily_exercise_pkey" primary key ("id"));`);
    this.addSql(`create index "daily_exercise_account_id_index" on "daily_exercise" ("account_id");`);
    this.addSql(`create index "daily_exercise_date_index" on "daily_exercise" ("date");`);
    this.addSql(`alter table "daily_exercise" add constraint "daily_exercise_account_id_date_unique" unique ("account_id", "date");`);

    this.addSql(`create table "daily_nutrients" ("id" uuid not null, "account_id" uuid not null, "date" varchar(10) not null, "energy" double precision not null default 0, "carb" double precision not null default 0, "protein" double precision not null default 0, "fat" double precision not null default 0, "energy_goal" double precision not null default 0, "fetched_at" timestamptz not null, constraint "daily_nutrients_pkey" primary key ("id"));`);
    this.addSql(`create index "daily_nutrients_account_id_index" on "daily_nutrients" ("account_id");`);
    this.addSql(`create index "daily_nutrients_date_index" on "daily_nutrients" ("date");`);
    this.addSql(`alter table "daily_nutrients" add constraint "daily_nutrients_account_id_date_unique" unique ("account_id", "date");`);

    this.addSql(`create table "day_snapshot" ("id" uuid not null, "account_id" uuid not null, "date" varchar(10) not null, "consumed" jsonb null, "exercises" jsonb null, "water" jsonb null, "goals" jsonb null, "goals_unmodified" jsonb null, "feeling" jsonb null, "fetched_at" timestamptz not null, constraint "day_snapshot_pkey" primary key ("id"));`);
    this.addSql(`create index "day_snapshot_account_id_index" on "day_snapshot" ("account_id");`);
    this.addSql(`create index "day_snapshot_date_index" on "day_snapshot" ("date");`);
    this.addSql(`alter table "day_snapshot" add constraint "day_snapshot_account_id_date_unique" unique ("account_id", "date");`);

    this.addSql(`create table "export_file" ("id" uuid not null, "account_id" uuid not null, "date_from" varchar(10) not null, "date_to" varchar(10) not null, "datasets" jsonb not null, "formats" jsonb not null, "granularity" text not null default 'auto', "redact" boolean not null default false, "status" text not null default 'running', "file_name" text null, "file_path" text null, "size_bytes" bigint null, "tables" jsonb not null, "error" text null, "created_at" timestamptz not null, "finished_at" timestamptz null, constraint "export_file_pkey" primary key ("id"));`);
    this.addSql(`create index "export_file_account_id_index" on "export_file" ("account_id");`);

    this.addSql(`create table "product_cache" ("id" uuid not null, "account_id" uuid not null, "product_id" text not null, "payload" jsonb not null, "name" text null, "fetched_at" timestamptz not null, constraint "product_cache_pkey" primary key ("id"));`);
    this.addSql(`alter table "product_cache" add constraint "product_cache_account_id_product_id_unique" unique ("account_id", "product_id");`);

    this.addSql(`create table "recipe_cache" ("id" uuid not null, "account_id" uuid not null, "recipe_id" text not null, "payload" jsonb not null, "is_user_recipe" boolean not null default false, "fetched_at" timestamptz not null, constraint "recipe_cache_pkey" primary key ("id"));`);
    this.addSql(`alter table "recipe_cache" add constraint "recipe_cache_account_id_recipe_id_unique" unique ("account_id", "recipe_id");`);

    this.addSql(`create table "sync_run" ("id" uuid not null, "account_id" uuid not null, "mode" text not null default 'incremental', "status" text not null default 'queued', "phase" text null, "date_from" varchar(10) not null, "date_to" varchar(10) not null, "datasets" jsonb not null, "all_days" boolean not null default false, "force" boolean not null default false, "days_total" int not null default 0, "days_done" int not null default 0, "requests" int not null default 0, "warnings_count" int not null default 0, "cancel_requested" boolean not null default false, "error" text null, "started_at" timestamptz null, "finished_at" timestamptz null, "created_at" timestamptz not null, constraint "sync_run_pkey" primary key ("id"));`);
    this.addSql(`create index "sync_run_account_id_index" on "sync_run" ("account_id");`);
    this.addSql(`create index "sync_run_status_index" on "sync_run" ("status");`);

    this.addSql(`create table "sync_warning" ("id" uuid not null, "run_id" uuid not null, "phase" text not null, "endpoint" text not null, "key" text null, "kind" text not null default 'http', "status" int null, "message" text not null, "created_at" timestamptz not null, constraint "sync_warning_pkey" primary key ("id"));`);
    this.addSql(`create index "sync_warning_run_id_index" on "sync_warning" ("run_id");`);

    this.addSql(`alter table "account_snapshot" add constraint "account_snapshot_account_id_foreign" foreign key ("account_id") references "account" ("id") on update cascade on delete cascade;`);

    this.addSql(`alter table "body_value" add constraint "body_value_account_id_foreign" foreign key ("account_id") references "account" ("id") on update cascade on delete cascade;`);

    this.addSql(`alter table "daily_exercise" add constraint "daily_exercise_account_id_foreign" foreign key ("account_id") references "account" ("id") on update cascade on delete cascade;`);

    this.addSql(`alter table "daily_nutrients" add constraint "daily_nutrients_account_id_foreign" foreign key ("account_id") references "account" ("id") on update cascade on delete cascade;`);

    this.addSql(`alter table "day_snapshot" add constraint "day_snapshot_account_id_foreign" foreign key ("account_id") references "account" ("id") on update cascade on delete cascade;`);

    this.addSql(`alter table "export_file" add constraint "export_file_account_id_foreign" foreign key ("account_id") references "account" ("id") on update cascade on delete cascade;`);

    this.addSql(`alter table "product_cache" add constraint "product_cache_account_id_foreign" foreign key ("account_id") references "account" ("id") on update cascade on delete cascade;`);

    this.addSql(`alter table "recipe_cache" add constraint "recipe_cache_account_id_foreign" foreign key ("account_id") references "account" ("id") on update cascade on delete cascade;`);

    this.addSql(`alter table "sync_run" add constraint "sync_run_account_id_foreign" foreign key ("account_id") references "account" ("id") on update cascade on delete cascade;`);

    this.addSql(`alter table "sync_warning" add constraint "sync_warning_run_id_foreign" foreign key ("run_id") references "sync_run" ("id") on update cascade on delete cascade;`);
  }

}
