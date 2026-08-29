import { Migration } from '@mikro-orm/migrations';

export class Migration20260828114302 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table "health_daily" ("id" uuid not null, "account_id" uuid not null, "date" varchar(10) not null, "type" text not null, "source" text not null, "unit" text null, "samples" int not null default 0, "sum" double precision not null default 0, "min" double precision null, "max" double precision null, "avg" double precision null, constraint "health_daily_pkey" primary key ("id"));`);
    this.addSql(`create index "health_daily_account_id_index" on "health_daily" ("account_id");`);
    this.addSql(`create index "health_daily_date_index" on "health_daily" ("date");`);
    this.addSql(`create index "health_daily_type_index" on "health_daily" ("type");`);
    this.addSql(`alter table "health_daily" add constraint "health_daily_account_id_date_type_source_unique" unique ("account_id", "date", "type", "source");`);

    this.addSql(`create table "health_import" ("id" uuid not null, "account_id" uuid not null, "file_path" text not null, "size_bytes" bigint not null default 0, "exported_at" varchar(19) null, "status" text not null default 'queued', "phase" text null, "bytes_read" bigint not null default 0, "records" int not null default 0, "workouts" int not null default 0, "days" int not null default 0, "type_counts" jsonb not null, "warnings" jsonb not null, "cancel_requested" boolean not null default false, "error" text null, "date_from" varchar(10) null, "date_to" varchar(10) null, "started_at" timestamptz null, "finished_at" timestamptz null, "created_at" timestamptz not null, constraint "health_import_pkey" primary key ("id"));`);
    this.addSql(`create index "health_import_account_id_index" on "health_import" ("account_id");`);
    this.addSql(`create index "health_import_status_index" on "health_import" ("status");`);

    this.addSql(`create table "health_point" ("id" uuid not null, "account_id" uuid not null, "type" text not null, "measured_at" varchar(19) not null, "date" varchar(10) not null, "value" double precision not null default 0, "unit" text null, "source" text null, constraint "health_point_pkey" primary key ("id"));`);
    this.addSql(`create index "health_point_account_id_index" on "health_point" ("account_id");`);
    this.addSql(`create index "health_point_type_index" on "health_point" ("type");`);
    this.addSql(`create index "health_point_date_index" on "health_point" ("date");`);
    this.addSql(`alter table "health_point" add constraint "health_point_account_id_type_measured_at_source_unique" unique ("account_id", "type", "measured_at", "source");`);

    this.addSql(`create table "health_sleep" ("id" uuid not null, "account_id" uuid not null, "night" varchar(10) not null, "source" text not null, "in_bed_min" double precision not null default 0, "asleep_min" double precision not null default 0, "deep_min" double precision not null default 0, "rem_min" double precision not null default 0, "core_min" double precision not null default 0, "awake_min" double precision not null default 0, "fell_asleep_at" varchar(19) null, "woke_at" varchar(19) null, constraint "health_sleep_pkey" primary key ("id"));`);
    this.addSql(`create index "health_sleep_account_id_index" on "health_sleep" ("account_id");`);
    this.addSql(`create index "health_sleep_night_index" on "health_sleep" ("night");`);
    this.addSql(`alter table "health_sleep" add constraint "health_sleep_account_id_night_source_unique" unique ("account_id", "night", "source");`);

    this.addSql(`create table "health_workout" ("id" uuid not null, "account_id" uuid not null, "date" varchar(10) not null, "started_at" varchar(19) not null, "ended_at" varchar(19) null, "type" text not null, "duration_min" double precision not null default 0, "energy_kcal" double precision null, "distance_km" double precision null, "source" text null, constraint "health_workout_pkey" primary key ("id"));`);
    this.addSql(`create index "health_workout_account_id_index" on "health_workout" ("account_id");`);
    this.addSql(`create index "health_workout_date_index" on "health_workout" ("date");`);
    this.addSql(`alter table "health_workout" add constraint "health_workout_account_id_started_at_type_unique" unique ("account_id", "started_at", "type");`);

    this.addSql(`alter table "health_daily" add constraint "health_daily_account_id_foreign" foreign key ("account_id") references "account" ("id") on update cascade on delete cascade;`);

    this.addSql(`alter table "health_import" add constraint "health_import_account_id_foreign" foreign key ("account_id") references "account" ("id") on update cascade on delete cascade;`);

    this.addSql(`alter table "health_point" add constraint "health_point_account_id_foreign" foreign key ("account_id") references "account" ("id") on update cascade on delete cascade;`);

    this.addSql(`alter table "health_sleep" add constraint "health_sleep_account_id_foreign" foreign key ("account_id") references "account" ("id") on update cascade on delete cascade;`);

    this.addSql(`alter table "health_workout" add constraint "health_workout_account_id_foreign" foreign key ("account_id") references "account" ("id") on update cascade on delete cascade;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "health_daily" cascade;`);

    this.addSql(`drop table if exists "health_import" cascade;`);

    this.addSql(`drop table if exists "health_point" cascade;`);

    this.addSql(`drop table if exists "health_sleep" cascade;`);

    this.addSql(`drop table if exists "health_workout" cascade;`);
  }

}
