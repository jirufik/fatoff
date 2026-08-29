import { ArrayNotEmpty, ArrayUnique, IsArray, IsBoolean, IsIn, IsOptional, IsString, Matches } from 'class-validator';

import { DATASETS, EXPORT_FORMATS, type Dataset, type ExportFormat, type Granularity } from '@fatoff/contracts';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export class CreateExportDto {
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
  datasets?: Dataset[];

  @IsArray()
  @ArrayNotEmpty({ message: 'Не выбран ни один формат' })
  @ArrayUnique()
  @IsIn(EXPORT_FORMATS as unknown as string[], { each: true })
  formats!: ExportFormat[];

  @IsOptional()
  @IsIn(['auto', 'day', 'week', 'month'])
  granularity?: Granularity;

  @IsOptional()
  @IsBoolean()
  redact?: boolean;
}
