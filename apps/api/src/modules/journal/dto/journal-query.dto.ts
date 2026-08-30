import { Transform, Type } from 'class-transformer';

import type { JournalSort } from '@fatoff/contracts';
import { IsBoolean, IsIn, IsInt, IsOptional, Matches, Max, Min } from 'class-validator';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export class JournalQueryDto {
  @IsOptional()
  @Matches(ISO_DATE, { message: 'Начало периода должно быть в формате YYYY-MM-DD' })
  from?: string;

  @IsOptional()
  @Matches(ISO_DATE, { message: 'Конец периода должен быть в формате YYYY-MM-DD' })
  to?: string;

  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true' || value === '1')
  @IsBoolean()
  withFood?: boolean;

  /** Только дни с обеими половинами: и съедено, и потрачено. */
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true' || value === '1')
  @IsBoolean()
  withBalance?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  pageSize?: number;

  /** Пусто — по дате, от свежего к старому: отдельной кнопки у этого порядка нет. */
  @IsOptional()
  @IsIn(['score', 'protein', 'energy', 'workout'])
  sort?: JournalSort;

  @IsOptional()
  @IsIn(['asc', 'desc'])
  dir?: 'asc' | 'desc';
}
