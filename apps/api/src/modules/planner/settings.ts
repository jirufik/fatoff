import { PLANNER_SETTINGS, type GenerateRequest } from '@fatoff/contracts';

/**
 * Приведение настроек к границам из справочника.
 *
 * Настройки приходят из браузера, а браузеру верить нельзя: ширина поиска в сто
 * тысяч или отрицательный темп снижения — это не ошибка ввода, а способ положить
 * сервис. Границы уже описаны в `PLANNER_SETTINGS` — там же, откуда интерфейс
 * строит форму, — поэтому проверка идёт по тому же списку, а не по второй его
 * копии в валидаторе.
 *
 * Всё, чего в справочнике нет, отбрасывается: неизвестная настройка не должна
 * доезжать до алгоритма.
 */
export function clampPlannerSettings(
  input: Pick<GenerateRequest, 'targets' | 'algorithm'>,
): Pick<GenerateRequest, 'targets' | 'algorithm'> {
  const result: Record<string, unknown> = {};

  for (const spec of PLANNER_SETTINGS) {
    const path = spec.key.split('.');
    const value = read(input as Record<string, unknown>, path);
    if (value === undefined || value === null) continue;

    if (spec.kind === 'toggle') {
      write(result, path, value === true || value === 'true');
      continue;
    }

    const num = Number(value);
    if (!Number.isFinite(num)) continue;
    write(result, path, clamp(num, spec.min, spec.max));
  }

  return result as Pick<GenerateRequest, 'targets' | 'algorithm'>;
}

function read(source: Record<string, unknown>, path: string[]): unknown {
  let current: unknown = source;
  for (const key of path) {
    if (typeof current !== 'object' || current === null) return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

function write(target: Record<string, unknown>, path: string[], value: unknown): void {
  let current = target;
  for (const key of path.slice(0, -1)) {
    if (typeof current[key] !== 'object' || current[key] === null) current[key] = {};
    current = current[key] as Record<string, unknown>;
  }
  current[path[path.length - 1]] = value;
}

function clamp(value: number, min?: number, max?: number): number {
  let result = value;
  if (min !== undefined) result = Math.max(min, result);
  if (max !== undefined) result = Math.min(max, result);
  return result;
}
