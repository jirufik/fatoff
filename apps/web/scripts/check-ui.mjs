/**
 * Прогон интерфейса в браузере: раскрытие дня до состава приёма пищи и сборка
 * режима генератором.
 *
 * Проверяет то, чего не видят юнит-тесты: что разметка не разъехалась, что
 * раскрытие правда что-то раскрывает и что кнопка «Сгенерировать» доводит дело
 * до плана с меню. Требует запущенного сервиса и загруженных данных.
 *
 *   BASE=http://localhost:4090 PASSWORD=… ACCOUNT=<uuid> \
 *     node apps/web/scripts/check-ui.mjs
 *
 * Снимки экрана кладутся в SHOTS, если он задан.
 */
import { mkdir } from 'node:fs/promises';

import { chromium } from 'playwright';

const BASE = process.env.BASE ?? 'http://localhost:4291';
const PASSWORD = process.env.PASSWORD;
const ACCOUNT = process.env.ACCOUNT;
const SHOTS = process.env.SHOTS;

if (!ACCOUNT) {
  console.error('Задайте ACCOUNT — идентификатор аккаунта с загруженными данными.');
  process.exit(2);
}
if (!PASSWORD) {
  console.error('Задайте PASSWORD — пароль входа в сервис (APP_PASSWORD из .env).');
  process.exit(2);
}

const problems = [];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });

page.on('console', (message) => message.type() === 'error' && problems.push(`консоль: ${message.text()}`));
page.on('pageerror', (error) => problems.push(`ошибка страницы: ${error.message}`));

if (SHOTS) await mkdir(SHOTS, { recursive: true });
const shot = async (name) => SHOTS && page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });

await page.goto(`${BASE}/login`);
await page.fill('input[type=password]', PASSWORD);
await page.click('button[type=submit]');
await page.waitForURL(`${BASE}/`, { timeout: 10_000 });
await page.evaluate(() => localStorage.setItem('fatoff:locale', 'ru'));
await page.reload();
await page.waitForTimeout(400);

// ── день целиком ────────────────────────────────────────────────────────────
await page.goto(`${BASE}/accounts/${ACCOUNT}/journal`);
await page.waitForSelector('.day', { timeout: 10_000 });
console.log('дней на странице:', await page.locator('.day').count());
// навигация одна на все страницы аккаунта и стоит на одном месте
const navOn = async () => {
  const links = await page.locator('.account-nav__link').count();
  const active = await page.locator('.account-nav__link--on').count();
  return { links, active };
};
const journalNav = await navOn();
if (journalNav.links !== 8 || journalNav.active !== 1) {
  problems.push(`полоса разделов на дне: ${journalNav.links} ссылок, ${journalNav.active} активных`);
}
await shot('journal-list');

await page.locator('.day__head').first().click();
await page.waitForSelector('.day__body', { timeout: 10_000 });
await page.waitForTimeout(400);

const meals = await page.locator('.meal__head').count();
const parts = await page.locator('.part').count();
console.log('приёмов пищи:', meals, '| составляющих оценки:', parts);
if (meals === 0) problems.push('день раскрылся без приёмов пищи');
if (parts !== 6) problems.push(`составляющих оценки ${parts}, ожидалось 6`);
if ((await page.locator('.legend').count()) === 0) problems.push('нет пояснения к оценке дня');
if ((await page.locator('.head .back').count()) === 0) problems.push('нет кнопки возврата');

/*
 * Полоска составляющей должна быть окрашена по уровню, а не всегда одинаково.
 * Проверяется соответствие «уровень → цвет», а не то, что уровней сегодня два:
 * в почти пустом дне все шесть составляющих честно одного уровня, и требование
 * двух цветов начинало ругаться на данные, а не на вёрстку.
 */
const fills = await page.locator('.part .progress__fill').evaluateAll((els) =>
  els.map((el) => ({
    level: [...el.classList].find((name) => name.startsWith('progress__fill--')) ?? '',
    color: getComputedStyle(el).backgroundColor,
  })),
);
const byLevel = new Map();
for (const fill of fills) {
  if (!fill.level) problems.push('полоска составляющей без уровня');
  const seen = byLevel.get(fill.level);
  if (seen && seen !== fill.color) problems.push(`уровень ${fill.level} красится двумя цветами`);
  byLevel.set(fill.level, fill.color);
}
if (new Set(byLevel.values()).size !== byLevel.size) {
  problems.push('разные уровни составляющих красятся одинаково');
}
console.log('уровней у составляющих:', byLevel.size);
await shot('journal-day');

await page.locator('.meal__head').first().click();
await page.waitForTimeout(300);
const items = await page.locator('.meal table.data tbody tr').count();
console.log('позиций в приёме пищи:', items);
if (items === 0) problems.push('приём пищи раскрылся без состава');
await shot('journal-meal');

// быстрый отбор дней, где известны обе половины: и еда, и расход
await page.goto(`${BASE}/accounts/${ACCOUNT}/journal`);
await page.waitForSelector('.day', { timeout: 10_000 });
await page.waitForTimeout(600);
const daysAll = await page.locator('.pager__count').first().innerText().catch(() => '');

// отбор дней — переключатель из трёх кнопок, а не набор флажков: два флажка
// давали состояние, где галочка стоит, а ничего не меняет
const pills = await page.locator('.scope .pill').count();
if (pills !== 3) problems.push(`кнопок отбора дней ${pills}, ожидалось 3`);
await page.locator('.scope .pill').nth(2).click();
await page.waitForTimeout(1200);
if ((await page.locator('.scope .pill--on').count()) !== 1) {
  problems.push('отбор дней ведёт себя не как переключатель');
}

const withoutBalance = await page.locator('.day').evaluateAll((els) =>
  els.filter((el) => el.querySelector('.chip--mute')).length,
);
const bothShown = await page.locator('.day').count();
console.log('дней с обеими половинами на странице:', bothShown);
if (bothShown === 0) problems.push('фильтр «обе половины» не оставил ни одного дня');
if (withoutBalance > 0) problems.push(`среди отобранных дней ${withoutBalance} без баланса`);
if (!daysAll) problems.push('не нашлось счётчика дней до фильтра');
await shot('journal-balance');

// ── режим ───────────────────────────────────────────────────────────────────
await page.goto(`${BASE}/accounts/${ACCOUNT}/planner`);
await page.waitForSelector('.modes', { timeout: 10_000 });
await page.waitForTimeout(800);

const plannerNav = await navOn();
if (plannerNav.links !== 8 || plannerNav.active !== 1) {
  problems.push(`полоса разделов на режиме: ${plannerNav.links} ссылок, ${plannerNav.active} активных`);
}

const basic = await page.locator('.setting').count();
const modes = await page.locator('.mode').count();
const starters = await page.locator('.starter').count();
console.log('основных настроек:', basic, '| режимов:', modes, '| шаблонов:', starters - 1);
if (basic !== 5) problems.push(`основных настроек ${basic}, ожидалось 5`);
if (modes !== 4) problems.push(`режимов тренировок ${modes}, ожидалось 4`);
if (starters < 5) problems.push(`наборов настроек ${starters - 1}, ожидалось не меньше 4`);
if ((await page.locator('table.data tbody tr').count()) < 6) problems.push('таблица норм неполная');
if ((await page.locator('.sources a').count()) < 5) problems.push('нет ссылок на источники');
await shot('planner-top');

// выбор блюд: период дневника и отметки вручную
await page.locator('button:has-text("блюд")').first().click();
await page.waitForTimeout(300);
const poolRows = await page.locator('.dish-picker__row').count();
console.log('блюд в выборе:', poolRows);
if (poolRows === 0) problems.push('список блюд пуст');
await page.locator('.dish-picker__row').first().click();
await page.waitForTimeout(200);
if ((await page.locator('button:has-text("отмечено")').count()) === 0) {
  problems.push('отметка блюда не отразилась на кнопке');
}
await page.locator('button:has-text("снять отметки")').click();
await page.waitForTimeout(200);
await shot('planner-pool');

// вся сложность спрятана за одним раскрытием
await page.click('.disclose');
await page.waitForTimeout(300);
const groups = await page.locator('.group').count();
if (groups !== 6) problems.push(`групп настроек ${groups}, ожидалось 6`);

await page.locator('.group__head').first().click();
await page.waitForTimeout(200);
if ((await page.locator('.group__body .setting').count()) === 0) problems.push('группа раскрылась пустой');
await shot('planner-settings');

// сборка недели
await page.locator('button:has-text("Сгенерировать")').first().click();
await page.waitForSelector('.plan-day', { timeout: 30_000 });
await page.waitForTimeout(500);
const days = await page.locator('.plan-day').count();
console.log('дней в плане:', days);
if (days !== 7) problems.push(`дней в плане ${days}, ожидалось 7`);
// первый день плана раскрыт сразу после сборки
const mealCards = await page.locator('.meal-card').count();
if (mealCards === 0) problems.push('день плана вышел без меню');
await shot('planner-plan');

// ── правка готового плана ───────────────────────────────────────────────────
const dayKcal = () => page.locator('.plan-day').first().locator('.day__value').nth(1).innerText();
const before = await dayKcal();

await page.locator('.dish .row-btn').first().click();
await page.waitForSelector('.swap__list', { timeout: 5000 });
const options = await page.locator('.swap__row').count();
console.log('вариантов замены:', options);
if (options === 0) problems.push('замена блюда не предложила ни одного варианта');

// Escape обязан закрывать диалог: мышь не должна быть единственным выходом
await page.keyboard.press('Escape');
await page.waitForTimeout(250);
if ((await page.locator('.swap').count()) > 0) problems.push('диалог замены не закрылся по Escape');

await page.locator('.dish .row-btn').first().click();
await page.waitForSelector('.swap__list', { timeout: 5000 });
await page.locator('.swap__row').nth(1).click();
await page.waitForTimeout(1200);
if ((await dayKcal()) === before) problems.push('после замены блюда итог дня не пересчитался');

// баланс дня виден числом и цветом
const balanceChip = page.locator('.plan-day').first().locator('.chip').first();
const balanceText = await balanceChip.innerText();
console.log('баланс первого дня:', balanceText);
if (!/ккал/.test(balanceText)) problems.push(`в строке дня нет баланса: «${balanceText}»`);

// тренировку можно удлинить, и день пересчитывается
const burnBefore = await page.locator('.plan-day').first().locator('.day__block').nth(2).innerText();
const timeField = page.locator('.plan-day').first().locator('.workout__time').first();
if ((await timeField.count()) === 0) {
  problems.push('в раскрытом дне нельзя поменять тренировку');
} else {
  await timeField.fill('120');
  await timeField.press('Enter');
  await page.waitForTimeout(1500);
  const burnAfter = await page.locator('.plan-day').first().locator('.day__block').nth(2).innerText();
  if (burnAfter === burnBefore) problems.push('правка тренировки не пересчитала баланс дня');

  const added = await page.locator('.plan-day').first().locator('.workout').count();
  await page.locator('.plan-day').first().locator('button:has-text("добавить тренировку")').click();
  await page.waitForTimeout(1200);
  if ((await page.locator('.plan-day').first().locator('.workout').count()) !== added + 1) {
    problems.push('тренировка не добавилась');
  }
}

// закрепление переживает следующую сборку
await page.locator('.dish').first().locator('.row-btn').nth(1).click();
await page.waitForTimeout(200);
if ((await page.locator('.chip--info:has-text("закреплено")').count()) === 0) {
  problems.push('закрепление блюда не отразилось');
}
await shot('planner-edit');

// набор настроек: выбирается и снимается повторным нажатием
const gentle = page.locator('.starter:has-text("Мягкий темп")');
await gentle.locator('button').first().click();
await page.waitForTimeout(500);
if ((await page.locator('.starter--on').count()) !== 1) problems.push('набор настроек не отметился');
const rateField = page.locator('[data-setting="targets.lossRatePctPerWeek"]').first();
const rate = await rateField.inputValue();
if (Number(rate) !== 0.4) problems.push(`набор не подставил темп: ${rate}`);

await gentle.locator('button').first().click();
await page.waitForTimeout(500);
if ((await page.locator('.starter--on').count()) !== 0) problems.push('набор нельзя снять повторным нажатием');
if (Number(await rateField.inputValue()) !== 0.65) {
  problems.push('снятие набора не вернуло значения по умолчанию');
}

// режим тренировок выбирается карточкой, а не набором
await page.locator('.mode:has-text("По нормам ВОЗ")').click();
await page.waitForTimeout(200);
await page.locator('button:has-text("Сгенерировать")').first().click();
await page.waitForSelector('text=Режим «По нормам ВОЗ»', { timeout: 30_000 });
await page.waitForTimeout(400);

// в раскрытом дне должны быть и тренировки, и меню
if ((await page.locator('.plan-day .workout, .plan-day .day__body p:has-text("День отдыха")').count()) === 0) {
  problems.push('в раскрытом дне не видно тренировок');
}
// ищем по подписи, а не по порядку: состав сводки со временем меняется
const whoWorkouts = await page.evaluate(() => {
  const stats = [...document.querySelectorAll('.stats')].pop();
  for (const cell of stats?.children ?? []) {
    if (cell.querySelector('.stat__label')?.textContent?.trim() === 'Тренировок') {
      return cell.querySelector('.stat__value')?.textContent?.trim() ?? '';
    }
  }
  return '';
});
console.log('по нормам ВОЗ тренировок:', whoWorkouts);
if (Number(whoWorkouts) !== 5) problems.push(`по ВОЗ вышло ${whoWorkouts} тренировок, ожидалось 5`);
await shot('planner-who');

// ── сохранение плана, метки и просмотр ──────────────────────────────────────
// метки задаются выбором, а не строкой через запятую: набранная руками метка
// «Разгон » не совпадала с заведённой «разгон», и фильтр их разводил
const stamp = `проверка-${Date.now()}`;
await page.locator('.save-form--plan input').first().fill(`План ${stamp}`);
await page.locator('.save-form--plan .tags__add input').fill(stamp);
await page.locator('.save-form--plan .tags__add button').click();
await page.waitForTimeout(150);
if ((await page.locator('.save-form--plan .tag--on').count()) !== 1) {
  problems.push('метка не отметилась в форме сохранения');
}
await page.locator('.save-form--plan button:has-text("Сохранить")').click();
await page.waitForTimeout(900);

await page.goto(`${BASE}/accounts/${ACCOUNT}/plans`);
await page.waitForSelector('.plan', { timeout: 10_000 });
await page.waitForTimeout(400);

// заведённая метка попала в фильтр
if ((await page.locator(`.tag:has-text("${stamp}")`).count()) === 0) {
  problems.push('новая метка не появилась в фильтре планов');
}

// клик по названию открывает просмотр, и там виден состав дней
await page.locator(`.plan__name a:has-text("${stamp}")`).first().click();
await page.waitForURL(/\/plans\/[0-9a-f-]{36}$/, { timeout: 10_000 });
await page.waitForSelector('.day', { timeout: 10_000 });
await page.waitForTimeout(400);
const viewDays = await page.locator('.day').count();
const viewItems = await page.locator('.items li').count();
console.log(`просмотр плана: дней ${viewDays}, позиций ${viewItems}`);
if (viewDays !== 7) problems.push(`в просмотре плана дней ${viewDays}, ожидалось 7`);
if (viewItems === 0) problems.push('в просмотре плана не видно состава приёмов пищи');
await shot('plan-view');

// метку можно переименовать — во всех планах разом
await page.goBack();
await page.waitForSelector('.plan', { timeout: 10_000 });
await page.locator('button:has-text("Метки")').click();
await page.waitForTimeout(250);
const renamed = `${stamp}-новая`;
await page.locator(`.tag-row:has-text("${stamp}") button:has-text("Переименовать")`).click();
await page.locator('.tag-row__input').fill(renamed);
await page.locator('.tag-row button:has-text("Сохранить")').click();
await page.waitForTimeout(700);
if ((await page.locator(`.tag:has-text("${renamed}")`).count()) === 0) {
  problems.push('метка не переименовалась');
}
await shot('plans-tags');

// и убрать — план при этом остаётся
const plansBefore = await page.locator('.plan').count();
await page.locator(`.tag-row:has-text("${renamed}") button:has-text("Убрать")`).click();
await page.waitForTimeout(700);
if ((await page.locator(`.tag:has-text("${renamed}")`).count()) !== 0) {
  problems.push('метка не убралась');
}
if ((await page.locator('.plan').count()) !== plansBefore) {
  problems.push('удаление метки унесло с собой план');
}

// прогон убирает за собой: иначе каждый запуск оставляет в базе лишний план
page.once('dialog', (dialog) => dialog.accept());
await page.locator(`.plan:has-text("${stamp}") .btn--danger`).click();
await page.waitForTimeout(700);
if ((await page.locator(`.plan:has-text("${stamp}")`).count()) !== 0) {
  problems.push('план проверки не удалился');
}

await page.goto(`${BASE}/accounts/${ACCOUNT}/planner`);
await page.waitForSelector('.modes', { timeout: 10_000 });
await page.waitForTimeout(500);

// ── темы и гаммы ────────────────────────────────────────────────────────────
// проверяется не «красиво», а что переключатели правда меняют атрибуты и что
// ни одна гамма не оставляет текст неразличимым на подложке
const themeOf = () => page.evaluate(() => document.documentElement.getAttribute('data-theme'));

const themeButton = page.locator('.controls .icon-btn').nth(1);
await themeButton.click();
await page.waitForTimeout(200);
if ((await themeOf()) !== 'light') problems.push('первое нажатие не включило светлую тему');

await themeButton.click();
await page.waitForTimeout(200);
if ((await themeOf()) !== 'dark') problems.push('второе нажатие не включило тёмную тему');
await shot('planner-dark');

// каждая гамма проверяется на обеих сторонах: тёмная нарисована отдельно от
// светлой, и промах в одной из них другой не виден
for (const palette of ['catppuccin', 'nord', 'graphite', 'tokyo']) {
  await page.locator('.picker .icon-btn').click();
  await page.locator(`.menu__item:has(.swatch[data-palette="${palette}"])`).click();
  await page.waitForTimeout(250);

  const applied = await page.evaluate(() => document.documentElement.getAttribute('data-palette'));
  const want = palette === 'tokyo' ? null : palette;
  if (applied !== want) problems.push(`гамма «${palette}» не применилась (стоит «${applied}»)`);

  for (const mode of ['dark', 'light']) {
    await page.evaluate((m) => document.documentElement.setAttribute('data-theme', m), mode);
    await page.waitForTimeout(120);

    const value = await page.evaluate(() => {
      const lum = (rgb) => {
        const [r, g, b] = rgb.match(/\d+/g).slice(0, 3).map((v) => {
          const c = Number(v) / 255;
          return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
        });
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
      };
      const style = getComputedStyle(document.querySelector('.card'));
      const [a, b] = [lum(style.color), lum(style.backgroundColor)].sort((x, y) => y - x);
      return (a + 0.05) / (b + 0.05);
    });

    if (value < 7) {
      problems.push(`гамма «${palette}», ${mode}: контраст текста ${value.toFixed(1)}, нужно 7`);
    }

    // жёлто-коричневого в системе быть не должно ни в одной гамме: тёмный
    // жёлтый читается как грязь, светлый — как золото
    const warm = await page.evaluate(() => {
      const hue = (rgb) => {
        const [r, g, b] = rgb.match(/\d+(\.\d+)?/g).slice(0, 3).map((v) => Number(v) / 255);
        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        const span = max - min;
        if (span === 0) return { h: 0, s: 0 };
        const light = (max + min) / 2;
        const s = span / (1 - Math.abs(2 * light - 1));
        let h;
        if (max === r) h = ((g - b) / span) % 6;
        else if (max === g) h = (b - r) / span + 2;
        else h = (r - g) / span + 4;
        return { h: (h * 60 + 360) % 360, s };
      };

      const found = new Set();
      for (const el of document.querySelectorAll('body *')) {
        const style = getComputedStyle(el);
        for (const prop of ['color', 'backgroundColor', 'borderLeftColor', 'fill', 'stroke']) {
          const value = style[prop];
          if (!value || !value.startsWith('rgb') || value.includes(', 0)')) continue;
          const { h, s } = hue(value);
          if (h >= 20 && h <= 65 && s > 0.2) found.add(`${el.className || el.tagName} · ${prop} · ${value}`);
        }
      }
      return [...found].slice(0, 4);
    });

    for (const hit of warm) {
      problems.push(`гамма «${palette}», ${mode}: жёлто-коричневый — ${hit}`);
    }
  }

  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
  await shot(`palette-${palette}`);
}

// ── узкий экран ─────────────────────────────────────────────────────────────
// проверяется главное: страница не должна ехать вбок
await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));
await page.setViewportSize({ width: 390, height: 844 });
for (const [name, path] of [
  // обзор попал сюда не зря: длинная почта в заголовке раздвигала страницу до
  // 417px, и телефон показывал её уменьшенной целиком
  ['overview', `/accounts/${ACCOUNT}`],
  ['journal', `/accounts/${ACCOUNT}/journal`],
  ['planner', `/accounts/${ACCOUNT}/planner`],
  ['plans', `/accounts/${ACCOUNT}/plans`],
  ['guide', `/accounts/${ACCOUNT}/guide`],
  ['data', `/accounts/${ACCOUNT}/data`],
]) {
  await page.goto(`${BASE}${path}`);
  await page.waitForSelector('.card', { timeout: 10_000 });
  await page.waitForTimeout(900);

  const overflow = await page.evaluate(() => {
    // элементы внутри своей горизонтальной прокрутки не в счёт: они там и живут
    const inScroller = (el) => {
      for (let node = el.parentElement; node; node = node.parentElement) {
        const overflowX = getComputedStyle(node).overflowX;
        if (overflowX === 'auto' || overflowX === 'scroll' || overflowX === 'hidden') return true;
      }
      return false;
    };

    const wide = [];
    for (const el of document.querySelectorAll('body *')) {
      if (inScroller(el)) continue;
      const box = el.getBoundingClientRect();
      if (box.width > 0 && box.right > window.innerWidth + 1) {
        wide.push(`${el.tagName}.${String(el.className).slice(0, 40)} → ${Math.round(box.right)}px`);
      }
    }
    return { scroll: document.documentElement.scrollWidth, view: window.innerWidth, wide: wide.slice(0, 3) };
  });

  if (overflow.scroll > overflow.view + 1) {
    problems.push(`${name} на 390px едет вбок: ${overflow.scroll}px при ${overflow.view}px — ${overflow.wide.join('; ')}`);
  }

  /*
   * Мало того, что страница целиком не едет вбок: свою боковую прокрутку не
   * должен заводить и кусок внутри неё. Меню, вкладки и формулы так и попались
   * — страница стояла на месте, а полоса разделов, вкладки «Данных» и каждая
   * формула прокручивались сами, и на телефоне это выглядит одинаково: скролл.
   *
   * Таблицы данных — исключение: колонок бывает полсотни, и переносить их
   * некуда. Они и живут в `.table-wrap`, где прокрутка задумана.
   */
  const inner = await page.evaluate(() =>
    [...document.querySelectorAll('body *')]
      .filter((el) => {
        if (el.scrollWidth <= el.clientWidth + 1) return false;
        if (el.closest('.table-wrap')) return false;
        // `hidden` обрезает, а не прокручивает: строка с многоточием шире своей
        // рамки по устройству, но утянуть её пальцем нельзя
        const overflowX = getComputedStyle(el).overflowX;
        return overflowX === 'auto' || overflowX === 'scroll';
      })
      .map((el) => `${el.tagName}.${String(el.className).slice(0, 30)} ${el.clientWidth}→${el.scrollWidth}`)
      .slice(0, 4),
  );
  if (inner.length > 0) problems.push(`${name} на 390px: вбок едет ${inner.join(' ; ')}`);

  await shot(`mobile-${name}`);
}

// разметка: кнопка внутри кнопки — невалидно, и браузеры чинят её по-разному
const nested = await page.evaluate(
  () => document.querySelectorAll('button button, a button, button a').length,
);
if (nested > 0) problems.push(`вложенных интерактивных элементов: ${nested}`);

// календарь свой, а не браузерный: по-русски, с понедельника, в теме страницы
await page.setViewportSize({ width: 1280, height: 900 });
await page.goto(`${BASE}/accounts/${ACCOUNT}/journal`);
await page.waitForSelector('.day', { timeout: 10_000 });
if ((await page.locator('input[type="date"]').count()) > 0) {
  problems.push('на странице остались браузерные поля даты');
}
await page.locator('.date__toggle').first().click();
await page.waitForSelector('.cal', { timeout: 5000 });
const weekdays = await page.locator('.cal__week span').allInnerTexts();
if (weekdays[0] !== 'пн') problems.push(`календарь начинается не с понедельника: ${weekdays[0]}`);
const monthTitle = await page.locator('.cal__title').innerText();
if (!/[а-я]/i.test(monthTitle)) problems.push(`месяц в календаре не по-русски: ${monthTitle}`);

await page.locator('.cal__day:not(.cal__day--out)').nth(9).click();
await page.waitForTimeout(700);
const picked = await page.locator('.date__input').first().inputValue();
if (!/^\d{2}\.\d{2}\.\d{4}$/.test(picked)) problems.push(`дата после выбора: «${picked}»`);
await shot('calendar');

// ── два языка ───────────────────────────────────────────────────────────────
await page.goto(`${BASE}/accounts/${ACCOUNT}/planner`);
await page.waitForSelector('.modes', { timeout: 10_000 });
await page.waitForTimeout(900);

const modeTitleRu = await page.locator('.mode strong').first().innerText();
await page.locator('.icon-btn--text').click();
await page.waitForTimeout(600);
const modeTitleEn = await page.locator('.mode strong').first().innerText();
console.log(`язык: «${modeTitleRu}» → «${modeTitleEn}»`);

if (modeTitleRu === modeTitleEn) problems.push('переключение языка ничего не поменяло');
if (!/^[A-Za-z ]+$/.test(modeTitleEn)) problems.push(`в английской версии осталось «${modeTitleEn}»`);
if ((await page.evaluate(() => document.documentElement.lang)) !== 'en') {
  problems.push('атрибут lang у страницы не сменился');
}

// в английской версии не должно остаться кириллицы в подписях интерфейса
const cyrillicOn = async () => page.evaluate(() => {
  const found = [];
  const skip = new Set(['SCRIPT', 'STYLE']);
  const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let node = walk.nextNode(); node; node = walk.nextNode()) {
    if (skip.has(node.parentElement?.tagName ?? '')) continue;
    // названия продуктов и меток пишет сама пользовательница — их не переводят
    // содержимое таблиц и списков — её дневник, а не подписи интерфейса
    if (
      node.parentElement?.closest(
        // имя аккаунта и название плана пишет сама пользовательница: это её
        // текст, а не подпись интерфейса, и переводить его нечем
        'td, .dish, .chip--mute, .swap__row, .dish-picker, .plan, .file-name, .tag, .head h1, .account-nav__who, .email, .card--link strong',
      )
    ) {
      continue;
    }
    const text = (node.textContent ?? '').trim();
    if (/[а-яё]/i.test(text)) found.push(text.slice(0, 60));
  }
  return [...new Set(found)].slice(0, 4);
});

// каждый раздел проверяется отдельно: перевести один и забыть остальные легко
for (const [name, path] of [
  ['overview', ''],
  ['journal', '/journal'],
  ['planner', '/planner'],
  ['plans', '/plans'],
  ['guide', '/guide'],
  ['data', '/data'],
  ['sync', '/sync'],
  ['export', '/export'],
]) {
  await page.goto(`${BASE}/accounts/${ACCOUNT}${path}`);
  await page.waitForSelector('.card, .page', { timeout: 10_000 });
  await page.waitForTimeout(700);

  const left = await cyrillicOn();
  if (left.length > 0) problems.push(`${name}, en: осталось по-русски — ${left.join(' | ')}`);
}

// страницы вне аккаунта забыть проще всего: справочник полей, список аккаунтов,
// выгрузки и форма нового аккаунта прожили без перевода дольше всех
for (const [name, path] of [
  ['fields', '/fields'],
  ['accounts', '/'],
  ['exports', '/exports'],
  ['new-account', '/accounts/new'],
]) {
  await page.goto(`${BASE}${path}`);
  await page.waitForSelector('.card, h1', { timeout: 10_000 });
  await page.waitForTimeout(700);
  const left = await cyrillicOn();
  if (left.length > 0) problems.push(`${name}, en: осталось по-русски — ${left.join(' | ')}`);
}

await page.goto(`${BASE}/accounts/${ACCOUNT}/planner`);
await page.waitForSelector('.modes', { timeout: 10_000 });
await page.waitForTimeout(600);
await shot('planner-en');

await page.locator('.icon-btn--text').click();
await page.waitForTimeout(500);

// одинаковые id — невалидная разметка: подпись начинает вести не на своё поле
const duplicateIds = await page.evaluate(() => {
  const seen = new Set();
  const twice = new Set();
  for (const el of document.querySelectorAll('[id]')) {
    if (seen.has(el.id)) twice.add(el.id);
    seen.add(el.id);
  }
  return [...twice].slice(0, 5);
});
if (duplicateIds.length > 0) problems.push(`повторяющиеся id: ${duplicateIds.join(', ')}`);

// ── документация ────────────────────────────────────────────────────────────
await page.setViewportSize({ width: 1400, height: 1000 });
await page.goto(`${BASE}/accounts/${ACCOUNT}/guide`);
await page.waitForSelector('.brief', { timeout: 10_000 });
await page.waitForTimeout(900);

const formulas = await page.locator('.formula').count();
const figures = await page.locator('.figure svg').count();
console.log('формул:', formulas, '| схем:', figures);
if (formulas < 5) problems.push(`формул в документации ${formulas}, ожидалось не меньше 5`);
if (figures < 3) problems.push(`схем в документации ${figures}, ожидалось не меньше 3`);

// числа в примерах — живые, а не прочерки
const dashes = await page.locator('.formula').evaluateAll((els) =>
  els.filter((el) => (el.textContent ?? '').includes('—')).length,
);
if (dashes > 0) problems.push(`в ${dashes} формулах остались прочерки вместо чисел`);

await page.locator('.doc-group__head').first().click();
await page.waitForTimeout(300);
const documented = await page.locator('.doc-list dt').count();
if (documented === 0) problems.push('раздел настроек в документации пуст');
await shot('guide');

// поле без атрибута type не должно доставаться браузеру со своим оформлением
const rawInputs = await page.evaluate(() => {
  const bad = [];
  for (const el of document.querySelectorAll('input')) {
    if (['checkbox', 'radio', 'file', 'range'].includes(el.type)) continue;
    const style = getComputedStyle(el);
    if (parseFloat(style.borderTopLeftRadius) < 4) bad.push(el.getAttribute('placeholder') ?? el.type);
  }
  return bad;
});
if (rawInputs.length > 0) problems.push(`поля без общего оформления: ${rawInputs.join(', ')}`);

await browser.close();

console.log(problems.length === 0 ? '\nПРОВЕРКА ПРОЙДЕНА' : `\nПРОБЛЕМЫ:\n- ${problems.join('\n- ')}`);
process.exit(problems.length === 0 ? 0 : 1);
