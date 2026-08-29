import { describe, expect, it } from 'vitest';

import { EN } from './en';
import { RU } from './ru';
import { pickText, translate, translateMessage } from './index';

describe('словари', () => {
  it('в обоих языках один и тот же набор ключей', () => {
    const onlyRu = Object.keys(RU).filter((key) => !(key in EN));
    const onlyEn = Object.keys(EN).filter((key) => !(key in RU));

    expect({ onlyRu, onlyEn }).toEqual({ onlyRu: [], onlyEn: [] });
  });

  it('подстановки совпадают в обеих версиях', () => {
    const holes = (text: string): string[] =>
      [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();

    const mismatched = Object.keys(RU).filter(
      (key) => holes(RU[key]).join() !== holes(EN[key]).join(),
    );
    expect(mismatched).toEqual([]);
  });

  it('ни одна строка не осталась непереведённой', () => {
    // одинаковый текст допустим только там, где переводить нечего
    // имена собственные и аббревиатуры не переводятся
    const SAME_ON_PURPOSE = new Set([
      'app.name',
      'common.none',
      'macro.energy',
      'sync.health',
      'plans.pdf',
      'journal.legend.mid',
      'drive',
      'health',
      'drive.url.hint',
    ]);
    const copied = Object.keys(RU).filter(
      (key) => RU[key] === EN[key] && !SAME_ON_PURPOSE.has(key) && !/^[\d\s—-]*$/.test(RU[key]),
    );
    expect(copied).toEqual([]);
  });

  it('сообщение из старого плана отдаётся как есть', () => {
    // до перехода на коды в сохранённых планах лежала готовая фраза; показать
    // её честнее, чем `msg.undefined` на месте предупреждения
    expect(translateMessage('en', 'Белка мало' as unknown as { code: string })).toBe('Белка мало');
    expect(translateMessage('ru', undefined as unknown as { code: string })).toBe('');
  });

  it('подставляет значения и падает на язык по умолчанию', () => {
    expect(translate('ru', 'msg.training.current', { count: 7 })).toContain('7 занятий');
    expect(translate('en', 'msg.training.current', { count: 7 })).toContain('7 sessions');
    // неизвестный ключ возвращается как есть, а не пустой строкой
    expect(translate('en', 'нет.такого')).toBe('нет.такого');
  });

  it('собирает сообщение сервера по коду', () => {
    const message = { code: 'targets.ea-current-low', params: { value: 28.2, threshold: 30 } };
    expect(translateMessage('ru', message)).toContain('28.2');
    expect(translateMessage('en', message)).toContain('28.2');
  });

  it('двуязычное поле выбирается по языку, строка остаётся строкой', () => {
    expect(pickText('en', { ru: 'Обед', en: 'Lunch' })).toBe('Lunch');
    expect(pickText('ru', { ru: 'Обед', en: 'Lunch' })).toBe('Обед');
    expect(pickText('en', 'Моя неделя')).toBe('Моя неделя');
    expect(pickText('en', null)).toBe('');
  });
});
