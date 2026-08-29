import { Migration } from '@mikro-orm/migrations';

export class Migration20260828132914 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table "meal_plan" ("id" uuid not null, "account_id" uuid not null, "name" text not null, "date_from" varchar(10) not null, "date_to" varchar(10) not null, "plan" jsonb not null, "created_at" timestamptz not null, constraint "meal_plan_pkey" primary key ("id"));`);
    this.addSql(`create index "meal_plan_account_id_index" on "meal_plan" ("account_id");`);

    this.addSql(`create table "plan_template" ("id" uuid not null, "account_id" uuid not null, "name" text not null, "description" text not null default '', "settings" jsonb not null, "created_at" timestamptz not null, constraint "plan_template_pkey" primary key ("id"));`);
    this.addSql(`create index "plan_template_account_id_index" on "plan_template" ("account_id");`);

    this.addSql(`alter table "meal_plan" add constraint "meal_plan_account_id_foreign" foreign key ("account_id") references "account" ("id") on update cascade on delete cascade;`);

    this.addSql(`alter table "plan_template" add constraint "plan_template_account_id_foreign" foreign key ("account_id") references "account" ("id") on update cascade on delete cascade;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "meal_plan" cascade;`);

    this.addSql(`drop table if exists "plan_template" cascade;`);
  }

}
