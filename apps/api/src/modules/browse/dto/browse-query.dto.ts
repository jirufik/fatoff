import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Matches, Max, Min } from 'class-validator';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Общее для всех таблиц просмотра: период, страница и направление сортировки. */
class PagedQueryDto {
  @IsOptional()
  @Matches(ISO_DATE, { message: 'Начало периода должно быть в формате YYYY-MM-DD' })
  from?: string;

  @IsOptional()
  @Matches(ISO_DATE, { message: 'Конец периода должен быть в формате YYYY-MM-DD' })
  to?: string;

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

  @IsOptional()
  @IsIn(['asc', 'desc'])
  dir?: 'asc' | 'desc';
}

export class DiaryQueryDto extends PagedQueryDto {
  @IsOptional()
  @IsIn(['breakfast', 'lunch', 'dinner', 'snack'])
  meal?: string;

  @IsOptional()
  @IsIn(['product', 'recipe_portion', 'simple_product'])
  kind?: string;

  @IsOptional()
  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().slice(0, 100) : value))
  search?: string;

  @IsOptional()
  @IsIn(['date', 'energy', 'product'])
  sort?: 'date' | 'energy' | 'product';
}

export class DayQueryDto extends PagedQueryDto {
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true' || value === '1')
  @IsBoolean()
  withFood?: boolean;

  @IsOptional()
  @IsIn(['date', 'energy'])
  sort?: 'date' | 'energy';
}

export class ProductQueryDto extends PagedQueryDto {
  @IsOptional()
  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().slice(0, 100) : value))
  search?: string;

  @IsOptional()
  @IsIn(['entries', 'energy', 'name'])
  sort?: 'entries' | 'energy' | 'name';
}

export class MeasurementQueryDto extends PagedQueryDto {
  @IsOptional()
  @IsIn(['weight', 'body_fat', 'muscle_ratio', 'waist', 'hip', 'chest'])
  kind?: string;
}
