import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsDefined,
  IsIn,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

import { MEALS, TRAINING_MODES, type MealKey, type TrainingMode } from '@fatoff/contracts';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/*
 * Порядок объявлений важен: `emitDecoratorMetadata` вписывает ссылку на класс
 * в момент, когда декорируется поле, а не когда до него дойдёт выполнение.
 * Вложенный класс, объявленный ниже того, кто его использует, даёт при запуске
 * `Cannot access before initialization` — и только при запуске: компилятор об
 * этом молчит. Поэтому вложенные идут первыми.
 */

class ManualWorkoutInput {
  @IsInt()
  @Min(1)
  @Max(7)
  weekday!: number;

  @IsString()
  @MaxLength(64)
  type!: string;

  @IsNumber()
  @Min(5)
  @Max(600)
  durationMin!: number;
}

class TrainingInput {
  @IsIn([...TRAINING_MODES])
  mode!: TrainingMode;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(21)
  @ValidateNested({ each: true })
  @Type(() => ManualWorkoutInput)
  manual?: ManualWorkoutInput[];

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(14)
  sessionsPerWeek?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(7)
  strengthPerWeek?: number;
}

/** Из чего собирать: период дневника и, если задан, отобранный набор блюд. */
class PoolFilterInput {
  @IsOptional()
  @Matches(ISO_DATE, { message: 'Начало периода блюд должно быть в формате YYYY-MM-DD' })
  from?: string;

  @IsOptional()
  @Matches(ISO_DATE, { message: 'Конец периода блюд должен быть в формате YYYY-MM-DD' })
  to?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(2000)
  @IsString({ each: true })
  keys?: string[];
}

class PinnedInput {
  @IsOptional()
  @Matches(ISO_DATE)
  date?: string;

  @IsIn([...MEALS])
  meal!: MealKey;

  @IsString()
  @MaxLength(200)
  key!: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(5000)
  amount?: number;
}

class RecostItemInput {
  @IsString()
  @MaxLength(200)
  key!: string;

  @IsNumber()
  @Min(0)
  @Max(5000)
  amount!: number;
}

class RecostMealInput {
  @IsIn([...MEALS])
  meal!: MealKey;

  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => RecostItemInput)
  items!: RecostItemInput[];
}

/**
 * Числовые настройки не перечисляются здесь по одной: их границы уже описаны в
 * `PLANNER_SETTINGS`, и вторая копия тех же чисел в декораторах разошлась бы с
 * первой при первом же изменении. Здесь проверяется форма, а значения приводит
 * `clampPlannerSettings`.
 */
export class GenerateDto {
  @Matches(ISO_DATE, { message: 'Начало периода должно быть в формате YYYY-MM-DD' })
  from!: string;

  @Matches(ISO_DATE, { message: 'Конец периода должен быть в формате YYYY-MM-DD' })
  to!: string;

  @IsOptional()
  @IsArray()
  @IsIn([...MEALS], { each: true })
  meals?: MealKey[];

  // без `@IsDefined` вложенная проверка молча пропускает `undefined`, и
  // запрос без режима тренировок падает пятисоткой вместо внятного отказа
  @IsDefined()
  @ValidateNested()
  @Type(() => TrainingInput)
  training!: TrainingInput;

  @IsOptional()
  @IsObject()
  targets?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  algorithm?: Record<string, unknown>;

  @IsOptional()
  @ValidateNested()
  @Type(() => PoolFilterInput)
  pool?: PoolFilterInput;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(60)
  @ValidateNested({ each: true })
  @Type(() => PinnedInput)
  pinned?: PinnedInput[];

  @IsOptional()
  @IsInt()
  @Min(0)
  seed?: number;
}

export class SavePlanDto {
  @IsString()
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(40, { each: true })
  tags?: string[];

  @IsObject()
  plan!: Record<string, unknown>;
}

export class UpdatePlanDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(40, { each: true })
  tags?: string[];
}

export class RenameTagDto {
  @IsString()
  @MaxLength(40)
  from!: string;

  @IsString()
  @MaxLength(40)
  to!: string;
}

export class PlanQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  search?: string;

  /** В строке запроса метки приходят через запятую: `?tags=работа,мягкий`. */
  @IsOptional()
  @Transform(({ value }) =>
    typeof value === 'string'
      ? value
          .split(',')
          .map((tag) => tag.trim())
          .filter(Boolean)
      : (value as string[]),
  )
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  tags?: string[];

  @IsOptional()
  @Matches(ISO_DATE)
  from?: string;

  @IsOptional()
  @Matches(ISO_DATE)
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
  @Max(100)
  pageSize?: number;
}

export class SaveTemplateDto {
  @IsString()
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @IsObject()
  settings!: Record<string, unknown>;
}

export class TargetsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(1.5)
  rate?: number;
}

export class PoolQueryDto {
  @IsOptional()
  @Matches(ISO_DATE)
  from?: string;

  @IsOptional()
  @Matches(ISO_DATE)
  to?: string;
}

export class RecostDto {
  @Matches(ISO_DATE)
  date!: string;

  @IsNumber()
  @Min(0)
  @Max(10_000)
  workoutKcal!: number;

  @IsArray()
  @ArrayMaxSize(8)
  @ValidateNested({ each: true })
  @Type(() => RecostMealInput)
  meals!: RecostMealInput[];

  @IsOptional()
  @IsObject()
  targets?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  algorithm?: Record<string, unknown>;

  @IsOptional()
  @ValidateNested()
  @Type(() => PoolFilterInput)
  pool?: PoolFilterInput;
}
