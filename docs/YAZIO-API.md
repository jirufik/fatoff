# YAZIO API — что выяснено на живом аккаунте (28.08.2026)

База: `https://yzapi.yazio.com`, версия пути — `v9`.
v9 не проверяет версию клиента в User-Agent (v22 отвечает `403 version_blocked`,
когда YAZIO выводит из обращения сборку, которой представился клиент).

## Авторизация
POST `/v9/oauth/token`, тело — JSON (форма тоже принимается):
```
{"client_id":"<YAZIO_CLIENT_ID>",
 "client_secret":"<YAZIO_CLIENT_SECRET>",
 "username":"...","password":"...","grant_type":"password"}
```
Ответ: `{access_token, expires_in: 172800, refresh_token, token_type:"bearer"}` — 48 ч.
Обновление: тот же путь, `grant_type=refresh_token`, `refresh_token=...`.
Пара client_id/secret — не пользовательский секрет, она одна на все установки приложения.
Для v22 пара другая: v9 и v22 не взаимозаменяемы. В репозитории пары нет — она
приходит из `.env` (`YAZIO_CLIENT_ID`, `YAZIO_CLIENT_SECRET`, D-086). Достаётся
она из трафика самого приложения — тем же прокси, что и `apps/api/scripts/capture-token.py`:
пара едет открыто в теле запроса `/oauth/token`.
Дальше — `Authorization: Bearer <access_token>`.

## Эндпоинты (все GET)
| путь | стоимость | отдаёт |
|---|---|---|
| `/user` | 1 | профиль, `registration_date`, единицы, цель, диета |
| `/user/settings` | 1 | тумблеры приложения |
| `/user/dietary-preferences` | 1 | ограничения питания |
| `/user/subscription` | 1 | подписки |
| `/user/streak` | 1 | карта дней `{ "YYYY-MM-DD": {daytimes[], origin_of_recovery} }` |
| `/user/fasting-countdowns/history` | 1 | история голоданий |
| `/user/consumed-items/nutrients-daily?start&end` | 1 на диапазон | дневные итоги YAZIO: energy, carb, protein, fat, energy_goal |
| `/user/exercises/summary-daily?start&end` | 1 на диапазон | steps, duration, energy по дням |
| `/user/bodyvalues/{kind}?start&end` | 1 на вид | kind: weight, body_fat, muscle_ratio, waist, hip, chest |
| `/user/consumed-items?date=` | 1 на день | дневник: products[], recipe_portions[], simple_products[] |
| `/user/exercises?date=` | 1 на день | activity{steps,distance,duration,energy} + training[] |
| `/user/water-intake?date=` | 1 на день | `{water_intake}`; 404 = ничего не пили |
| `/user/goals?date=` | 1 на день | цели дня, ключи через точку |
| `/user/goals/unmodified?date=` | 1 на день | цели без ручных правок |
| `/user/feeling?date=` | 1 на день | заметка дня и теги настроения; 404 = пусто |
| `/products/{id}` | 1 на продукт | нутриенты **на одну базовую единицу** (грамм/мл), servings[] |
| `/recipes/{id}` → 404 → `/user/recipes/{id}` | 1–2 на рецепт | нутриенты **на порцию**, ingredients, instructions |

404 на дневных эндпоинтах = «не записано», не ошибка.

## Единицы
Нутриенты приходят в **граммах на одну базовую единицу** (не на 100!), энергия — ккал.
Оливковое масло = 8.22 kcal (за грамм). В дневнике надо умножать на `amount`.
Отсутствующий ключ ≠ ноль: YAZIO просто не присылает то, чего не знает.

## Реестр нутриентов (54, канонический порядок колонок)
energy.energy→energy_kcal ×1; nutrient.carb→carbs_g; nutrient.protein→protein_g;
nutrient.fat→fat_g; nutrient.saturated→saturated_fat_g; nutrient.monounsaturated→monounsaturated_fat_g;
nutrient.polyunsaturated→polyunsaturated_fat_g; nutrient.transfat→trans_fat_g;
nutrient.cholesterol→cholesterol_mg ×1e3; nutrient.dietaryfiber→fiber_g; nutrient.sugar→sugar_g;
nutrient.addedsugar→added_sugar_g; nutrient.salt→salt_g; nutrient.sodium→sodium_mg ×1e3;
nutrient.water→water_g; nutrient.alcohol→alcohol_g;
vitamin.a→vitamin_a_ug ×1e6; vitamin.b1→vitamin_b1_mg ×1e3; vitamin.b2→vitamin_b2_mg ×1e3;
vitamin.b3→vitamin_b3_mg ×1e3; vitamin.b5→vitamin_b5_mg ×1e3; vitamin.b6→vitamin_b6_mg ×1e3;
vitamin.b7→vitamin_b7_ug ×1e6; vitamin.b11→folate_ug ×1e6; vitamin.b12→vitamin_b12_ug ×1e6;
vitamin.c→vitamin_c_mg ×1e3; vitamin.d→vitamin_d_ug ×1e6; vitamin.e→vitamin_e_mg ×1e3;
vitamin.k→vitamin_k_ug ×1e6;
mineral.calcium→calcium_mg ×1e3; mineral.iron→iron_mg ×1e3; mineral.magnesium→magnesium_mg ×1e3;
mineral.phosphorus→phosphorus_mg ×1e3; mineral.potassium→potassium_mg ×1e3; mineral.zinc→zinc_mg ×1e3;
mineral.copper→copper_mg ×1e3; mineral.manganese→manganese_mg ×1e3; mineral.selenium→selenium_ug ×1e6;
mineral.iodine→iodine_ug ×1e6; mineral.chlorine→chlorine_mg ×1e3; mineral.sulfur→sulfur_mg ×1e3;
mineral.fluoride→fluoride_mg ×1e3; mineral.fluorine→fluorine_mg ×1e3; mineral.biotin→biotin_ug ×1e6;
mineral.choline→choline_mg ×1e3; mineral.chrome→chromium_mg ×1e3; mineral.cobalt→cobalt_ug ×1e6;
mineral.molybdenum→molybdenum_ug ×1e6; mineral.boron→boron_mg ×1e3; mineral.silicon→silicon_mg ×1e3;
mineral.arsenic→arsenic_ug ×1e6; mineral.rubidium→rubidium_ug ×1e6; mineral.tin→tin_mg ×1e3;
mineral.vanadium→vanadium_ug ×1e6

## Проверено на живом аккаунте
- `registration_date` = 2026-08-28 06:54:51 — аккаунт заведён сегодня;
- за 28.08 уже записаны завтрак и обед (5+ позиций), вес и цели записаны;
- `unit_energy` = kj, `language`/`locale` = ru, страна FI, цель — похудение (-0.5 кг/нед);
- `is_premium` = false.

## Формы данных дневника
- `products[]`: {id, date (timestamp), daytime, type, product_id, amount, serving, serving_quantity}
- `recipe_portions[]`: {id, recipe_id, date, daytime, portion_count}
- `simple_products[]`: быстрая запись — {id, date, daytime, name, is_ai_generated, nutrients{...}}
  нутриенты уже итоговые, масштабировать не надо.
- daytime: breakfast | lunch | dinner | snack

## Набор таблиц (взято у 1zun4/fatoff как ориентир)
meta, tables, nutrition_log, daily_summary, meal_summary, daily_goals, daily_activity,
exercises, weight, body_values, feelings, streak, products, product_servings, recipes,
recipe_ingredients, recipe_instructions, settings, profile, subscriptions,
fasting_history, fasting_periods, fasting_patches, warnings

## Сверка арифметики
Свои суммы по дневнику против `nutrients-daily` YAZIO; расхождение > 0.5 % — в warnings.
Норма — единицы процентов дней: YAZIO хранит итоги «как было в момент записи»,
а пересчёт идёт по нынешней карточке продукта.

## Правила пересчёта (перенесены из 1zun4/fatoff)

- **Продукт в дневнике**: нутриенты карточки × `amount`. Карточка хранит значения
  на одну базовую единицу.
- **Рецепт в дневнике**: нутриенты карточки × `portion_count`. Карточка хранит
  значения **на порцию** (проверено автором утилиты: 69.09 ккал при
  `portion_count` 16 дали ровно 207.27 ккал для записи в три порции).
- **Быстрая запись** (`simple_products`): нутриенты уже итоговые, не масштабируются;
  `amount` у такой записи не существует — писать 0 было бы выдумкой.
- **Продукт не выгрузился**: строка дневника остаётся, имя — `Unknown (<id>)`,
  нутриенты пустые. Терять запись нельзя.
- **daily_summary**: макросы берутся у YAZIO как авторитетные, остальные нутриенты
  досчитываются из дневника. Строка есть на каждый день периода; невыгруженный
  день даёт пустые ячейки, а не нули.
- **daily_activity**: шаги, длительность и энергия берутся из диапазонного
  `summary-daily`, дистанция и происхождение — из дневного `exercises`.
- **weight / body_values**: отметка `YYYY-MM-DD HH:MM:SS` разбивается на дату
  (для соединения с другими таблицами) и полную отметку.
- **streak**: эндпоинт отдаёт календарь всего аккаунта, в таблицу идут только
  даты запрошенного периода.
- **settings**: длинная таблица «настройка — значение», а не широкая. Новый
  тумблер YAZIO попадает в выгрузку без правки кода.
- **Округление ячеек**: два знака; если значение при этом схлопнулось бы в ноль,
  берутся четыре значащих цифры (микрограммы). Целые печатаются без `.0`.
- **Сверка**: собственная сумма калорий за день против `nutrients-daily`; порог
  0.5 % от дневной энергии, но не меньше 1 ккал.

## Вход через Apple ID (не описан в спецификации сообщества)

У аккаунта, заведённого через Apple, пароля нет. Обменять токен Apple на токен
YAZIO может только клиент, зарегистрированный у Apple, — но у YAZIO есть
**веб-страница входа**, и она это делает за нас:

- страница: `https://www.yazio.com/en/app/account/login` (подключает
  `appleid.auth.js`, `siwaClientId = com.yazio-website.siwa`);
- фронтенд ходит не в `yzapi`, а в свой прокси `POST https://www.yazio.com/api/auth/token`
  с заголовком `x-client-type: web`; секрет клиента добавляется на их сервере;
- OAuth-клиент веб-версии: `7_9236kdzucvnd624cklgz787kcvhjfch6sbdejgmdv8387fj7v`;
- гранты, которые принимает эндпоинт: `password`, `refresh_token`,
  **`sign_in_with_apple`** (поле `jwt`), **`sign_in_with_google`** (поле `id_token`).
  Двух последних в опубликованной спецификации нет.

Что проверено на живом аккаунте 28.08.2026:

| проверка | результат |
|---|---|
| `POST www.yazio.com/api/auth/token` с `grant_type=password` и клиентом `7_…` | 200, выдаёт access и refresh |
| этот access против `yzapi.yazio.com/v9/user` | 200, профиль целиком |
| его refresh против `yzapi.yazio.com/v9/oauth/token` **парой клиента приложения `1_…`** | 200, выдаёт новую пару |
| полная синхронизация на таком токене | прошла, 20 запросов, ноль замечаний |

Третья строка — самая важная: refresh-токен не привязан к выдавшему клиенту,
поэтому сервис продлевает веб-токен своими средствами и повторно доставать его
не нужно.

**Refresh-токен не аннулируется при использовании.** Проверено: тот же токен
принимается повторно после того, как по нему уже выдали новую пару. Значит
резервная копия токенов не протухает после первого продления — она перестанет
работать, только если YAZIO отзовёт доступ.

## Что дал полный прогон на шестилетнем аккаунте (28.08.2026)

| показатель | значение |
|---|---|
| период | шесть с половиной лет (2377 дней) |
| дней с записями | 461 |
| запросов на первую выгрузку | 4342 |
| сбоев запросов | 0 |
| записей дневника | 7098 |
| расхождений при сверке с итогами YAZIO | **0** |
| сборка Markdown-дайджеста | 0.26 с, 12 КБ |

Ноль расхождений на 461 дне — самая сильная из доступных проверок: значит и
масштабирование продукта на количество, и рецепт на число порций, и быстрые
записи посчитаны верно. Автор утилиты-образца предупреждал, что на четырёхлетнем
аккаунте расхождения на ~1 % дней — норма; здесь их нет вовсе.
