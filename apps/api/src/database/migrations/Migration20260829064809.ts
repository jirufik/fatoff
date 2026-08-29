import { Migration } from '@mikro-orm/migrations';

export class Migration20260829064809 extends Migration {

  override async up(): Promise<void> {
    // у существующих планов меток нет — колонка приходит с пустым списком,
    // иначе `not null` не даёт добавить её к непустой таблице
    this.addSql(`alter table "meal_plan" add column "tags" jsonb not null default '[]'::jsonb;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "meal_plan" drop column "tags";`);
  }

}
