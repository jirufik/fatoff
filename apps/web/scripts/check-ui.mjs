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

/*
 * Раскрытие дня не двигает страницу под человеком (D-075).
 *
 * Раскрыт может быть только один день, поэтому клик по нижнему схлопывает
 * верхний — и со страницы над пальцем исчезает полторы тысячи пикселей.
 *
 * Проверяется с выключенным scroll anchoring: Chrome такой переезд сглаживает
 * сам, Safari на телефоне — нет, и человек видел именно то, что видит Safari.
 * Выключив подсказку браузера, проверяем свой код, а не чужой.
 */
/*
 * Числа в строке дня объяснены на месте, а не в подсказке по наведению (D-079).
 *
 * «Цель» и «в меню» — два слова, за которыми стоят расчёт расхода и подбор меню;
 * без пояснения это просто цифры. Пояснение обязано быть видимым текстом:
 * на телефоне наводить нечем, и подсказка через title туда не доедет.
 */
const numbersExplained = async (where) => {
  const lines = await page.locator('.numbers li').allInnerTexts();
  if (lines.length !== 3) {
    problems.push(`${where}: пояснений к числам ${lines.length}, ожидалось 3`);
    return;
  }
  // в первой строке стоит настоящая арифметика: расход, дефицит и цель
  const digits = (lines[0].match(/\d[\d\s ]*/g) ?? []).length;
  console.log(`${where}: чисел в пояснении к «цели» — ${digits}`);
  if (digits < 3) problems.push(`${where}: пояснение к «цели» без чисел: ${lines[0].slice(0, 80)}`);
  for (const word of ['цель', 'в меню', 'баланс']) {
    if (!lines.join(' ').toLowerCase().includes(word)) {
      problems.push(`${where}: пояснение не называет «${word}»`);
    }
  }
};

const staysInPlace = async (where, row, head, target, preOpen = null) => {
  await page.addStyleTag({ content: '*{overflow-anchor:none}' });

  if (preOpen !== null) {
    const first = page.locator(row).nth(preOpen);
    await first.scrollIntoViewIfNeeded();
    await first.locator(head).first().click();
    await page.waitForTimeout(1400);
  }

  const chosen = page.locator(row).nth(target);
  await chosen.scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);

  const button = chosen.locator(head).first();
  const before = (await button.boundingBox())?.y;
  await button.click();
  await page.waitForTimeout(1600);
  const after = (await button.boundingBox())?.y;

  if (before === undefined || after === undefined) {
    problems.push(`${where}: строку дня не удалось измерить`);
    return;
  }

  const shift = Math.round(after - before);
  console.log(`${where}: строка дня сдвинулась на ${shift} px`);
  if (Math.abs(shift) > 8) {
    problems.push(`${where}: при раскрытии строка дня уехала на ${shift} px`);
  }
};

await page.goto(`${BASE}/login`);
await page.fill('input[type=password]', PASSWORD);
await page.click('button[type=submit]');
await page.waitForURL(`${BASE}/`, { timeout: 10_000 });
await page.evaluate(() => localStorage.setItem('fatoff:locale', 'ru'));
await page.reload();
await page.waitForTimeout(400);

// ── день целиком ────────────────────────────────────────────────────────────
await page.goto(`${BASE}/accounts/${ACCOUNT}/journal`);
await page.waitForSelector('.scope .pill', { timeout: 10_000 });
// раскрывать надо день с едой: свежая выгрузка Apple Health добавляет сегодня,
// а сегодня приёмов пищи может не быть вовсе — проверка ломалась на данных
await page.locator('.scope .pill').nth(1).click();
await page.waitForTimeout(1200);
await page.waitForSelector('.day', { timeout: 10_000 });
console.log('дней на странице:', await page.locator('.day').count());

// раскрываем второй день, затем девятый: первый схлопнется выше пальца
await staysInPlace('журнал', '.day', '.day__head', 8, 1);
await page.locator('.day').nth(8).locator('.day__head').first().click();
await page.waitForTimeout(600);
/*
 * Навигация одна на все страницы аккаунта и стоит на одном месте.
 *
 * Полос было две, одна под другой; теперь одна (D-067). На широком экране в
 * ней четыре главных раздела и «Ещё», подсвечен ровно один: либо сам раздел,
 * либо «Ещё», если открыт раздел из-под него. Список для узкого экрана при
 * 1400px обязан быть спрятан — иначе разделы задвоятся.
 */
const checkNav = async (where) => {
  const pills = await page.locator('.bar__sections .pill').count();
  const active = await page.locator('.bar__sections .pill--on').count();
  if (pills !== 5) problems.push(`полоса разделов на ${where}: кнопок ${pills}, ожидалось 5`);
  if (active !== 1) problems.push(`полоса разделов на ${where}: подсвечено ${active}, ожидался 1`);
  if (await page.locator('.drop--narrow').isVisible()) {
    problems.push(`полоса разделов на ${where}: при 1400px показан узкий список`);
  }
};
await checkNav('дне');

/*
 * Сортировок ровно четыре, и все «лучшее сверху» (D-072). Проверяется и порядок,
 * и путь обратно: кнопки «по дате» нет, к хронологии возвращает повторное
 * нажатие — без этого человек, нажавший «белок», остаётся в нём навсегда.
 */
const sortNames = (await page.locator('.sorts button').allInnerTexts()).map((text) => text.trim());
if (sortNames.length !== 4) {
  problems.push(`кнопок сортировки ${sortNames.length}, ожидалось 4: ${sortNames.join(', ')}`);
}
const firstDate = () => page.locator('.day__date strong').first().innerText();
const dateBefore = await firstDate();

// белок берётся из своей разметки, а не разбором текста: в строке он выводится
// как «Б165», без пробела, и любой разбор по тексту тут же ломается
const proteins = async () =>
  (await page.locator('.day .macro--protein .value').allInnerTexts())
    .map((value) => Number(value.trim().replace(',', '.')))
    .filter(Number.isFinite);

const protein = page.locator('.sorts button').nth(1);

// первое нажатие — по убыванию
await protein.click();
await page.waitForTimeout(1200);
const down = await proteins();
if (down.length < 3) {
  problems.push(`белок не вычитался из строк дня: нашлось ${down.length} значений`);
} else if (!down.every((value, at) => at === 0 || down[at - 1] >= value)) {
  problems.push(`первое нажатие не дало убывание: ${down.slice(0, 6).join(', ')}`);
}
if (!(await protein.innerText()).includes('↓')) problems.push('нет стрелки убывания на выбранной сортировке');
if ((await page.locator('.sorts .btn--primary').count()) !== 1) {
  problems.push('выбранная сортировка не подсвечена');
}

// второе — по возрастанию
await protein.click();
await page.waitForTimeout(1200);
const up = await proteins();
if (up.length >= 3 && !up.every((value, at) => at === 0 || up[at - 1] <= value)) {
  problems.push(`второе нажатие не дало возрастание: ${up.slice(0, 6).join(', ')}`);
}
if (!(await protein.innerText()).includes('↑')) problems.push('нет стрелки возрастания');
if (down.length > 0 && up.length > 0 && down[0] === up[0]) {
  problems.push('направление не поменялось: первая строка та же');
}

// третье — выключено, и это единственная дорога обратно к порядку по дате
await protein.click();
await page.waitForTimeout(1200);
if ((await firstDate()) !== dateBefore) {
  problems.push('третье нажатие не вернуло порядок по дате');
}
if ((await page.locator('.sorts .btn--primary').count()) !== 0) {
  problems.push('сортировка снята, а подсветка осталась');
}

// разделов по-прежнему восемь: четыре на виду и четыре под «Ещё»
await page.locator('.bar__sections .drop .pill').click();
await page.waitForTimeout(200);
const hidden = await page.locator('.bar__sections .drop .menu__item').count();
if (hidden !== 4) problems.push(`под «Ещё» разделов ${hidden}, ожидалось 4`);
await page.keyboard.press('Escape');

// сервисное — под шестерёнкой: аккаунты, выгрузки, поля, язык, тема, выход
await page.locator('.gear').click();
await page.waitForTimeout(200);
const service = await page.locator('.menu--wide .menu__item, .menu--wide .row-item').count();
if (service < 6) problems.push(`под шестерёнкой пунктов ${service}, ожидалось не меньше 6`);
await page.keyboard.press('Escape');

// кнопки «назад» быть не должно: на неё уходила строка, а навигация и так есть
const back = await page.locator('.back').count();
if (back > 0) problems.push(`кнопок «назад» на странице: ${back}`);
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

/*
 * Порог приёмов пищи назван человеку теми же числами, что стоят в коде (D-078).
 *
 * Само правило стережёт интеграционный тест: там есть день с известным расходом
 * и двумя приёмами, и он обязан выпасть. Здесь проверяется другое — что подпись
 * под отбором осталась на месте и число в ней настоящее, а не забытая строка про
 * «обе половины». Подпись собирается подстановкой из той же константы, что и
 * условие в запросе, поэтому разойтись они могут только вместе с этой проверкой.
 */
const scopeNote = await page.locator('.scope-note, .scope + p, .row + .tiny').first().innerText()
  .catch(() => '');
const noteText = scopeNote || (await page.locator('main').innerText());
if (!/не меньше 3/.test(noteText)) {
  problems.push('подпись под отбором не называет порог в три приёма пищи');
}

// день целиком — это три приёма: раскрываем первый и считаем
await page.locator('.day').first().locator('.day__head').click();
await page.waitForTimeout(1500);
const mealsInDay = await page.locator('.day__body .meal').count();
console.log('приёмов пищи в отобранном дне:', mealsInDay);
if (mealsInDay > 0 && mealsInDay < 3) {
  problems.push(`в отобранном дне приёмов пищи ${mealsInDay}, а отбор обещает не меньше трёх`);
}
await page.locator('.day').first().locator('.day__head').click();
await page.waitForTimeout(500);

await shot('journal-balance');

// ── режим ───────────────────────────────────────────────────────────────────
await page.goto(`${BASE}/accounts/${ACCOUNT}/planner`);
await page.waitForSelector('.modes', { timeout: 10_000 });
await page.waitForTimeout(800);

await checkNav('режиме');

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

/*
 * Комплекты и ровные дни — то, о чём просил заказчик (D-073, D-074).
 *
 * Приём берётся из дневника целиком, и под его заголовком стоит день, из
 * которого взят состав: без этой подписи непонятно, что меню не выдумано.
 * Целевая калорийность у всех дней плана одна — тренировка её не двигает.
 */
const fromLabels = await page.locator('.meal-card__from').count();
console.log('приёмов взято комплектом:', fromLabels, 'из', mealCards);
if (fromLabels === 0) problems.push('ни один приём не взят из дневника комплектом');

const dayTargets = await page.locator('.plan-day').evaluateAll((days) =>
  days.map((day) => day.querySelector('.day__value')?.textContent?.trim() ?? ''),
);
const distinctTargets = [...new Set(dayTargets)];
console.log('целевая калорийность дней:', distinctTargets.join(' | '));
if (distinctTargets.length !== 1) {
  problems.push(`целевая калорийность разъехалась по дням: ${distinctTargets.join(', ')}`);
}

// первый день раскрыт сразу после сборки, поэтому клик по четвёртому схлопывает
// его — ровно тот случай, на который жаловались
await numbersExplained('режим');

await staysInPlace('режим', '.plan-day', '.day__head', 3);

// дальше прогон правит первый день, поэтому возвращаем раскрытым его
await page.locator('.plan-day').nth(3).locator('.day__head').first().click();
await page.waitForTimeout(400);
await page.locator('.plan-day').first().locator('.day__head').first().click();
await page.waitForTimeout(600);

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
await numbersExplained('просмотр плана');
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

// свет и гаммы живут строками меню под шестерёнкой; меню закрывается по выбору
// раздела, но не по смене темы — открываем один раз на весь блок проверок
const openGear = async () => {
  if ((await page.locator('.menu--wide').count()) === 0) {
    await page.locator('.gear').click();
    await page.waitForSelector('.menu--wide', { timeout: 5_000 });
  }
};
await openGear();

const themeButton = page.locator('.menu--wide .row-item').nth(1);
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
  await openGear();
  await page.locator(`.menu--wide .row-item:has(.swatch[data-palette="${palette}"])`).click();
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

    /*
     * Подложка модального окна обязана гасить страницу, а не высветлять её.
     *
     * Проверка нужна потому, что беда видна ровно в половине случаев: пока
     * затемнение считалось от чернил, на светлой стороне всё сходилось, а на
     * тёмной чернила светлые — и подложка выходила светлее самой страницы
     * (D-031). Меряется то, что увидит человек: цвет подложки смешивается с
     * фоном по своей прозрачности, а не берётся из текста правила.
     */
    const scrim = await page.evaluate(() => {
      // цвет приезжает в oklab: разобрать его как «три числа подряд» нельзя
      const linear = (css) => {
        const nums = css.match(/-?[\d.]+/g).map(Number);
        if (css.startsWith('oklab')) {
          const [L, a, b] = nums;
          const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
          const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
          const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
          return {
            rgb: [
              4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
              -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
              -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
            ],
            alpha: nums[3] ?? 1,
          };
        }
        const [r, g, b] = nums.slice(0, 3).map((v) => {
          const c = v / 255;
          return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
        });
        return { rgb: [r, g, b], alpha: nums[3] ?? 1 };
      };
      const bright = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

      const probe = document.createElement('div');
      probe.style.background = 'var(--scrim)';
      document.body.append(probe);
      const top = linear(getComputedStyle(probe).backgroundColor);
      probe.remove();

      const under = linear(getComputedStyle(document.body).backgroundColor);
      const mixed = top.rgb.map((c, i) => top.alpha * c + (1 - top.alpha) * under.rgb[i]);
      return { page: bright(under.rgb), dimmed: bright(mixed) };
    });

    if (scrim.dimmed >= scrim.page) {
      problems.push(
        `гамма «${palette}», ${mode}: подложка окна не гасит страницу — ` +
          `${scrim.dimmed.toFixed(3)} против фона ${scrim.page.toFixed(3)}`,
      );
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
//
// 360, а не 390: на 390 всё сходилось, а на распространённом андроидном 360
// длинное название раздела в шапке («Как это работает») выталкивало шестерёнку
// за край. Узкая ширина ловит строго больше, поэтому проверяем по ней.
await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));
await page.setViewportSize({ width: 360, height: 844 });
for (const [name, path] of [
  // обзор попал сюда не зря: длинная почта в заголовке раздвигала страницу до
  // 417px, и телефон показывал её уменьшенной целиком
  ['overview', `/accounts/${ACCOUNT}`],
  ['journal', `/accounts/${ACCOUNT}/journal`],
  ['planner', `/accounts/${ACCOUNT}/planner`],
  ['plans', `/accounts/${ACCOUNT}/plans`],
  ['guide', `/accounts/${ACCOUNT}/guide`],
  ['data', `/accounts/${ACCOUNT}/data`],
  // длинные названия разделов в шапке ломались именно здесь
  ['sync', `/accounts/${ACCOUNT}/sync`],
  ['export', `/accounts/${ACCOUNT}/export`],
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
    problems.push(`${name} на 360px едет вбок: ${overflow.scroll}px при ${overflow.view}px — ${overflow.wide.join('; ')}`);
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
  if (inner.length > 0) problems.push(`${name} на 360px: вбок едет ${inner.join(' ; ')}`);

  /*
   * Полоса на телефоне должна остаться узкой и в одну строку: ради этого
   * разделы и уехали под текущий (D-067). Две полосы занимали 525px до
   * содержимого — половину экрана.
   */
  if (!(await page.locator('.drop--narrow').isVisible())) {
    problems.push(`${name} на 360px: разделы не схлопнуты в список`);
  }
  if (await page.locator('.bar__sections').isVisible()) {
    problems.push(`${name} на 360px: разделы всё ещё вразбивку`);
  }
  const barHeight = await page.locator('.bar').evaluate((el) => el.getBoundingClientRect().height);
  if (barHeight > 56) problems.push(`${name} на 360px: полоса ${Math.round(barHeight)}px, ожидалось не выше 56`);

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

// ── синхронизация и Google Drive: настройки аккаунта ────────────────────────
// у каждого аккаунта своё время; общего расписания больше нет
await page.goto(`${BASE}/accounts/${ACCOUNT}/sync`);
await page.waitForSelector('.card', { timeout: 10_000 });
await page.waitForTimeout(800);

const dailyField = page.locator('input[placeholder="06:30"]').first();
if ((await dailyField.count()) === 0) problems.push('нет поля времени синхронизации');

/*
 * Разделы страницы — по предмету, а не по механизму.
 *
 * Было наоборот: Apple Health жил в двух разделах (файл с диска и файл из
 * Drive), а YAZIO — в трёх, вместе с расписанием среди токенов доступа.
 * Проверка держит порядок: сперва YAZIO целиком, потом Apple Health с двумя
 * источниками, потом аккаунт.
 */
/*
 * Три раздела и ничего больше: YAZIO, Apple Health, Удаление.
 *
 * Разделы прирастали по одному, пока их не стало семь, и предмет размазался
 * (D-065). Проверка держит и состав, и то, что подробности спрятаны.
 */
const sections = (await page.locator('section.card > h2').allInnerTexts()).map((s) => s.trim());
const wanted = ['YAZIO — дневник питания', 'Apple Health', 'Удаление'];
if (JSON.stringify(sections) !== JSON.stringify(wanted)) {
  problems.push(`разделы синхронизации: ${sections.join(' | ')}`);
}

// сводка сверху отвечает на главный вопрос: свежие ли данные
const summary = (await page.locator('.sum__when').allInnerTexts()).join(' / ');
console.log('сводка:', summary.replace(/\s+/g, ' '));
if (/ещё ни разу/.test(summary)) problems.push(`сводка не нашла прогонов: ${summary}`);

// подробности спрятаны, но раскрываются
if ((await page.locator('.more__body:visible').count()) !== 0) {
  problems.push('подробности видны сразу, а должны быть под раскрытием');
}
await page.locator('.more > summary').first().click();
await page.waitForTimeout(400);
if ((await page.locator('.more__body:visible').count()) === 0) {
  problems.push('раскрытие не открывается');
}

// удаление — со словом, а не с кнопкой «да»
await page.locator('button:has-text("Удалить аккаунт")').click();
await page.waitForTimeout(400);
const kill = page.locator('.modal button:has-text("Удалить навсегда")');
if ((await page.locator('.modal').count()) === 0) problems.push('окно удаления не открылось');
if (!(await kill.isDisabled())) problems.push('удаление доступно без подтверждения словом');
await page.locator('.modal input').fill('Удалить');
await page.waitForTimeout(250);
if (await kill.isDisabled()) problems.push('слово набрано, а удаление всё ещё запрещено');
await page.locator('.modal button:has-text("Отмена")').click();
await page.waitForTimeout(300);

await shot('sync-settings');

// ── два языка ───────────────────────────────────────────────────────────────
await page.goto(`${BASE}/accounts/${ACCOUNT}/planner`);
await page.waitForSelector('.modes', { timeout: 10_000 });
await page.waitForTimeout(900);

const modeTitleRu = await page.locator('.mode strong').first().innerText();
// язык — первая строка меню под шестерёнкой; меню за собой закрываем, иначе
// оно накроет страницу, по которой дальше ищется кириллица
await openGear();
await page.locator('.menu--wide .row-item').first().click();
await page.keyboard.press('Escape');
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
        'td, .dish, .chip--mute, .swap__row, .dish-picker, .plan, .file-name, .tag, .head h1, .who__name, .email, .account__name',
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

// обратно на русский
await openGear();
await page.locator('.menu--wide .row-item').first().click();
await page.keyboard.press('Escape');
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

// правило подбора описано человеку, а не только в коде (D-073)
const guideText = (await page.locator('main').innerText()).toLowerCase();
for (const word of ['комплект', 'завтрак', 'перекус']) {
  if (!guideText.includes(word)) problems.push(`объяснение не говорит про «${word}»`);
}

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

/*
 * ── демо-аккаунт ────────────────────────────────────────────────────────────
 *
 * Смысл демо в том, что после нажатия одной кнопки страницы перестают быть
 * пустыми (D-068). Ровно это здесь и проверяется: собрать демо и посмотреть,
 * что в днях есть дни, в планах — план, а в «Синхронизации» вместо YAZIO и
 * Apple Health стоит объяснение, почему синхронизировать нечего.
 */
await page.setViewportSize({ width: 1400, height: 1000 });
await page.goto(`${BASE}/`);
await page.waitForSelector('.stack, .card', { timeout: 10_000 });
await page.waitForTimeout(400);

const demoButton = page.locator('button:has-text("Создать демо")');
const demoLink = page.locator('a:has-text("Открыть демо")');
if ((await demoButton.count()) + (await demoLink.count()) === 0) {
  problems.push('на странице аккаунтов нет ни кнопки создания демо, ни ссылки на него');
}

// нажимаем всегда: пересборка заодно проверяет, что второе демо не плодится
const demo = await page.evaluate(async () => {
  const response = await fetch('/api/demo', {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ locale: 'ru' }),
  });
  return response.ok ? response.json() : null;
});

if (!demo) {
  problems.push('демо-аккаунт не собрался');
} else {
  console.log('демо:', demo.storedDays, 'дней,', demo.storedFrom, '—', demo.storedTo);
  if (demo.storedDays < 150) problems.push(`в демо всего ${demo.storedDays} дней`);
  if (demo.syncEnabled) problems.push('у демо включена синхронизация, которой у него нет');

  await page.goto(`${BASE}/accounts/${demo.id}/journal`);
  await page.waitForSelector('.day', { timeout: 15_000 });
  await page.waitForTimeout(900);
  const demoDays = await page.locator('.day').count();
  if (demoDays === 0) problems.push('в демо нет ни одного дня');

  /*
   * Оценки должны расходиться. Демо, где каждый день зелёный, показывает
   * только то, что кружок рисуется: разброс и есть половина смысла страницы.
   */
  const scores = await page.locator('.day .score__value').allInnerTexts();
  const values = scores.map((text) => Number(text.trim())).filter((value) => Number.isFinite(value));
  console.log('оценок на странице:', values.length, values.length > 0 ? `от ${Math.min(...values)} до ${Math.max(...values)}` : '');
  // пустой список означает, что селектор промахнулся, а не что всё хорошо
  if (values.length < 5) problems.push(`оценок на странице демо ${values.length}, ожидалось больше пяти`);
  if (values.length > 5 && Math.max(...values) - Math.min(...values) < 15) {
    problems.push(`оценки в демо почти не отличаются: от ${Math.min(...values)} до ${Math.max(...values)}`);
  }
  await shot('demo-journal');

  await page.goto(`${BASE}/accounts/${demo.id}/plans`);
  await page.waitForSelector('.card', { timeout: 15_000 });
  await page.waitForTimeout(700);
  if ((await page.locator('.plan').count()) === 0) problems.push('в демо не сохранён ни один план');

  await page.goto(`${BASE}/accounts/${demo.id}/sync`);
  await page.waitForSelector('.card', { timeout: 15_000 });
  await page.waitForTimeout(600);
  const sections = await page.locator('section.card h2').allInnerTexts();
  if (sections.length !== 2) {
    problems.push(`в «Синхронизации» демо ${sections.length} разделов, ожидалось 2: демо и удаление`);
  }
  if (sections.some((title) => title.includes('YAZIO') || title.includes('Apple Health'))) {
    problems.push('демо предлагают синхронизацию, которой у него нет');
  }
  await shot('demo-sync');

  /*
   * Удаление демо не требует набранного слова: терять нечего, а собрать заново
   * — одно нажатие (D-068). У настоящего аккаунта слово остаётся обязательным,
   * и это проверяется выше: послабление должно касаться только демо.
   */
  await page.getByRole('button', { name: /Удалить демо/ }).first().click();
  await page.waitForSelector('.modal', { timeout: 5_000 });
  await page.waitForTimeout(300);
  if ((await page.locator('.modal input[type=text]').count()) > 0) {
    problems.push('у демо просят набрать слово, хотя удаление ничего не уносит');
  }
  if (await page.locator('.modal button.btn--danger').isDisabled()) {
    problems.push('удаление демо заперто, а отпирать его нечем');
  }
  // подложка должна закрывать окно по щелчку мимо: без стилей она этого не умела
  await page.locator('.modal-scrim').click({ position: { x: 20, y: 20 } });
  await page.waitForTimeout(300);
  if ((await page.locator('.modal').count()) > 0) problems.push('щелчок мимо окна его не закрыл');

  await page.goto(`${BASE}/accounts/${demo.id}/planner`);
  await page.waitForSelector('.modes', { timeout: 15_000 });
  await page.waitForTimeout(900);
  const dashesInTargets = await page.locator('.targets td.num:has-text("—")').count();
  if (dashesInTargets > 2) problems.push(`нормы демо не посчитались: прочерков ${dashesInTargets}`);
  await shot('demo-planner');

  /*
   * Полный круг: удалить со страницы выбора и собрать заново.
   *
   * Ради него всё и затевалось — демо заводят посмотреть и убирают, когда
   * посмотрели. Проверяется, что кнопка после удаления возвращается: без этого
   * человек остаётся на странице, где демо уже нет, а создать его нечем.
   */
  await page.goto(`${BASE}/`);
  await page.waitForSelector('.actions', { timeout: 10_000 });
  await page.waitForTimeout(500);

  /*
   * Плитка кликается целиком, хотя ссылка обёрнута только вокруг имени: её
   * псевдоэлемент растянут на всю карточку (D-068). Проверяется щелчком мимо
   * имени — по пустому месту справа от него.
   */
  const card = page.locator('.account:has(.account__drop)');
  const box = await card.boundingBox();
  await page.mouse.click(box.x + box.width * 0.55, box.y + box.height - 12);
  await page.waitForTimeout(900);
  if (!/\/accounts\/[0-9a-f-]{36}$/.test(page.url())) {
    problems.push(`щелчок по плитке демо никуда не привёл: ${page.url()}`);
  }
  await page.goto(`${BASE}/`);
  await page.waitForSelector('.actions', { timeout: 10_000 });
  await page.waitForTimeout(500);

  await page.locator('.account__drop').click();
  await page.waitForSelector('.modal', { timeout: 5_000 });
  await page.locator('.modal button.btn--danger').click();
  await page.waitForTimeout(2_000);

  const left = await page.evaluate(async () => {
    const list = await (await fetch('/api/accounts', { credentials: 'include' })).json();
    return list.filter((item) => item.isDemo).length;
  });
  if (left !== 0) problems.push(`после удаления демо осталось ${left} штук`);
  if ((await page.locator('.actions button:has-text("Создать демо")').count()) === 0) {
    problems.push('после удаления не вернулась кнопка создания демо');
  }
  await shot('demo-deleted');

  // и собирается заново — окружение остаётся с демо, как было до проверки
  await page.locator('.actions button:has-text("Создать демо")').click();
  await page.waitForURL(/\/accounts\/[0-9a-f-]{36}$/, { timeout: 60_000 });
  await page.waitForSelector('.card', { timeout: 20_000 });
  console.log('демо удалено и собрано заново');
}

await browser.close();

console.log(problems.length === 0 ? '\nПРОВЕРКА ПРОЙДЕНА' : `\nПРОБЛЕМЫ:\n- ${problems.join('\n- ')}`);
process.exit(problems.length === 0 ? 0 : 1);
