import { Migration } from '@mikro-orm/migrations';

export class Migration20260828100040 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table "account" alter column "password_enc" type text using ("password_enc"::text);`);
    this.addSql(`alter table "account" alter column "password_enc" drop not null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "account" alter column "password_enc" type text using ("password_enc"::text);`);
    this.addSql(`alter table "account" alter column "password_enc" set not null;`);
  }

}
