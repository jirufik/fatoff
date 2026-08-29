import { Type } from 'class-transformer';
import { ArrayUnique, IsArray, IsBoolean, IsIn, IsOptional, IsString, Matches } from 'class-validator';

import { DATASETS, type Dataset, type SyncMode } from '@fatoff/contracts';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export class StartSyncDto {
  @IsOptional()
  @IsIn(['full', 'incremental', 'range'])
  mode?: SyncMode;

  @IsOptional()
  @Matches(ISO_DATE, { message: 'Начало периода должно быть в формате YYYY-MM-DD' })
  from?: string;

  @IsOptional()
  @Matches(ISO_DATE, { message: 'Конец периода должен быть в формате YYYY-MM-DD' })
  to?: string;

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  @IsIn(DATASETS as unknown as string[], { each: true })
  @Type(() => String)
  datasets?: Dataset[];

  @IsOptional()
  @IsBoolean()
  allDays?: boolean;

  @IsOptional()
  @IsBoolean()
  force?: boolean;
}
