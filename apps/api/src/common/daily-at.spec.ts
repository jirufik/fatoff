import { describe, expect, it } from 'vitest';

import { hhmmOf, isDailyAt, OncePerMinute } from './daily-at';

describe('расписание «ежедневно в ЧЧ:ММ»', () => {
  it('переводит время в ЧЧ:ММ с ведущими нулями', () => {
    expect(hhmmOf(new Date(2026, 7, 29, 6, 5))).toBe('06:05');
    expect(hhmmOf(new Date(2026, 7, 29, 23, 59))).toBe('23:59');
    expect(hhmmOf(new Date(2026, 7, 29, 0, 0))).toBe('00:00');
  });

  it('принимает только настоящее время суток', () => {
    for (const good of ['00:00', '06:30', '23:59']) {
      expect({ good, ok: isDailyAt(good) }).toEqual({ good, ok: true });
    }
    for (const bad of ['24:00', '6:30', '06:60', '', '0630', 'утром']) {
      expect({ bad, ok: isDailyAt(bad) }).toEqual({ bad, ok: false });
    }
  });

  it('в одну минуту отдаёт ключ один раз', () => {
    const once = new OncePerMinute();
    const at = new Date(2026, 7, 29, 6, 30);

    expect(once.claim('аккаунт-1', at)).toBe(true);
    // часы могут дёрнуться назад по NTP — минута наступит дважды
    expect(once.claim('аккаунт-1', at)).toBe(false);
    // другому аккаунту это не мешает
    expect(once.claim('аккаунт-2', at)).toBe(true);
  });

  it('в следующую минуту и на следующий день — снова можно', () => {
    const once = new OncePerMinute();
    once.claim('аккаунт', new Date(2026, 7, 29, 6, 30));

    expect(once.claim('аккаунт', new Date(2026, 7, 29, 6, 31))).toBe(true);
    expect(once.claim('аккаунт', new Date(2026, 7, 30, 6, 30))).toBe(true);
  });

  it('не копит отметки бесконечно', () => {
    const once = new OncePerMinute();
    for (let day = 1; day <= 80; day++) once.claim('аккаунт', new Date(2026, 7, day, 6, 30));

    // старые дни вычищаются, иначе множество растёт всю жизнь процесса
    expect(once.claim('аккаунт', new Date(2026, 7, 1, 6, 30))).toBe(true);
  });
});
