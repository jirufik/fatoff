import 'reflect-metadata';

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';

import { GenerateDto, PlanQueryDto, SavePlanDto } from './planner.dto';

/**
 * Проверка входа — это то, чем отличается внятный отказ от пятисотки.
 *
 * Проверяются не все поля подряд, а места, где `class-validator` молчит по
 * умолчанию: пропущенный вложенный объект и разбор строки запроса.
 */
const errorsOf = async (cls: new () => object, body: unknown): Promise<string[]> => {
  const dto = plainToInstance(cls, body, { enableImplicitConversion: true });
  const errors = await validate(dto as object, { whitelist: true, forbidNonWhitelisted: true });
  return errors.map((error) => error.property);
};

describe('проверка входа генератора', () => {
  const valid = {
    from: '2026-08-31',
    to: '2026-09-06',
    seed: 42,
    training: { mode: 'current' },
  };

  it('принимает полный запрос', async () => {
    expect(await errorsOf(GenerateDto, valid)).toEqual([]);
  });

  it('отказывает без режима тренировок, а не падает на нём', async () => {
    // `@ValidateNested` над `undefined` не срабатывает вовсе: без `@IsDefined`
    // запрос доходил до сервиса и падал пятисоткой на `training.mode`
    const { training, ...withoutTraining } = valid;
    expect(training).toBeDefined();
    expect(await errorsOf(GenerateDto, withoutTraining)).toEqual(['training']);
  });

  it('отказывает на неизвестном режиме тренировок', async () => {
    expect(await errorsOf(GenerateDto, { ...valid, training: { mode: 'нечто' } })).toEqual([
      'training',
    ]);
  });

  it('отказывает на дате не того вида', async () => {
    expect(await errorsOf(GenerateDto, { ...valid, from: '31.08.2026' })).toEqual(['from']);
  });

  it('план без имени не сохраняется без плана', async () => {
    expect(await errorsOf(SavePlanDto, { name: 'Неделя' })).toContain('plan');
  });
});

describe('разбор строки запроса к планам', () => {
  it('метки приходят через запятую и чистятся от пустот', async () => {
    const dto = plainToInstance(PlanQueryDto, { tags: 'лето, , разгон ' });
    expect(dto.tags).toEqual(['лето', 'разгон']);
    expect(await validate(dto)).toEqual([]);
  });

  it('без меток поле остаётся пустым, а не списком из пустой строки', async () => {
    expect(plainToInstance(PlanQueryDto, { search: 'неделя' }).tags).toBeUndefined();
    expect(plainToInstance(PlanQueryDto, { tags: '' }).tags).toEqual([]);
  });

  it('страница и размер страницы приходят числами', async () => {
    const dto = plainToInstance(PlanQueryDto, { page: '2', pageSize: '5' });
    expect({ page: dto.page, pageSize: dto.pageSize }).toEqual({ page: 2, pageSize: 5 });
    expect(await validate(dto)).toEqual([]);
  });
});
