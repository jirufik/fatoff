import { describe, expect, it } from 'vitest';

import { EN } from './en';
import { RU } from './ru';
import { pickText, pluralForm, translate, translateMessage } from './index';

describe('словари', () => {
  it('в обоих языках один и тот же набор ключей', () => {
    const onlyRu = Object.keys(RU).filter((key) => !(key in EN));
    const onlyEn = Object.keys(EN).filter((key) => !(key in RU));

    expect({ onlyRu, onlyEn }).toEqual({ onlyRu: [], onlyEn: [] });
  });

  it('подстановки совпадают в обеих версиях', () => {
    // и простые подстановки, и слова при числе: `{days}` и `{days:день|дня|дней}`
    const holes = (text: string): string[] =>
      [...new Set([...text.matchAll(/\{(\w+)(?::[^{}]+)?\}/g)].map((match) => match[1]))].sort();

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
      'health.never',
      'drive.url.hint',
    ]);
    const copied = Object.keys(RU).filter(
      (key) => RU[key] === EN[key] && !SAME_ON_PURPOSE.has(key) && !/^[\d\s—-]*$/.test(RU[key]),
    );
    expect(copied).toEqual([]);
  });

  it('согласует слово с числом по правилам языка', () => {
    const days = ['день', 'дня', 'дней'];
    expect([1, 2, 5, 11, 21, 22, 112].map((n) => pluralForm('ru', n, days))).toEqual([
      'день',
      'дня',
      'дней',
      'дней',
      'день',
      'дня',
      'дней',
    ]);
    // сервер пишет тысячи с пробелом — число всё равно узнаётся
    expect(pluralForm('ru', '15 374', ['шаг', 'шага', 'шагов'])).toBe('шага');
    expect(pluralForm('en', 1, ['day', 'days'])).toBe('day');
    expect(pluralForm('en', 3, ['day', 'days'])).toBe('days');
    expect(translate('ru', 'msg.analysis.protein.enough', { met: 1, days: 3 })).toContain('в 1 дне из 3');
    expect(translate('ru', 'home.period.days', { days: 21, total: 30 })).toBe('по 21 дню из 30');
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
