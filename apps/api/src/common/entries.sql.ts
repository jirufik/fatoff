/**
 * Развёртка дневника из сырья — общий SQL для просмотра, журнала и генератора.
 *
 * Отдельной таблицы под записи дневника нет (D-018): строки разворачиваются из
 * `day_snapshot` на лету, и инвариант «сырьё есть источник правды» остаётся
 * целым. Держать этот разбор в трёх местах — верный способ развести их: разница
 * в множителе или в имени нутриента проявится не ошибкой, а расхождением чисел
 * между страницами.
 *
 * Подстановки только позиционные: MikroORM отдаёт запрос драйверу как есть, и
 * именованные `:param` доезжают до PostgreSQL текстом. Параметры кладутся в
 * массив ровно в том порядке, в каком «?» идут в тексте, — их девять, по тройке
 * на ветку union.
 */

/**
 * Три вида записей, у каждого свой множитель `scale`: у продукта это съеденное
 * количество, у рецепта — число порций, у быстрой записи единица, потому что её
 * нутриенты уже итоговые.
 */
export const ENTRIES_CTE = `
  with entries as (
    select d.date,
           coalesce(item->>'date', d.date)      as logged_at,
           item->>'daytime'                     as meal,
           'product'                            as kind,
           item->>'product_id'                  as source_id,
           (item->>'amount')::float8            as amount,
           item->>'serving'                     as serving,
           coalesce(p.name, 'Unknown (' || (item->>'product_id') || ')') as name,
           p.payload->>'producer'               as producer,
           p.payload->>'base_unit'              as base_unit,
           p.payload->'nutrients'               as nutrients,
           (item->>'amount')::float8            as scale
      from day_snapshot d
      cross join lateral jsonb_array_elements(coalesce(d.consumed->'products', '[]'::jsonb)) item
      left join product_cache p
        on p.account_id = d.account_id and p.product_id = item->>'product_id'
     where d.account_id = ? and d.date between ? and ?

    union all

    select d.date,
           coalesce(item->>'date', d.date),
           item->>'daytime',
           'recipe_portion',
           item->>'recipe_id',
           (item->>'portion_count')::float8,
           'portion',
           coalesce(r.payload->>'name', 'Recipe (' || (item->>'recipe_id') || ')'),
           null::text,
           'portion',
           r.payload->'nutrients',
           (item->>'portion_count')::float8
      from day_snapshot d
      cross join lateral jsonb_array_elements(coalesce(d.consumed->'recipe_portions', '[]'::jsonb)) item
      left join recipe_cache r
        on r.account_id = d.account_id and r.recipe_id = item->>'recipe_id'
     where d.account_id = ? and d.date between ? and ?

    union all

    select d.date,
           coalesce(item->>'date', d.date),
           item->>'daytime',
           'simple_product',
           null,
           null::float8,
           null,
           coalesce(item->>'name', 'Quick added'),
           null::text,
           null::text,
           item->'nutrients',
           1::float8
      from day_snapshot d
      cross join lateral jsonb_array_elements(coalesce(d.consumed->'simple_products', '[]'::jsonb)) item
     where d.account_id = ? and d.date between ? and ?
  ),
  scaled as (
    select date, logged_at, meal, kind, source_id, amount, serving, name, producer, base_unit,
           (nutrients->>'energy.energy')::float8 * scale          as energy_kcal,
           (nutrients->>'nutrient.carb')::float8 * scale          as carbs_g,
           (nutrients->>'nutrient.protein')::float8 * scale       as protein_g,
           (nutrients->>'nutrient.fat')::float8 * scale           as fat_g,
           (nutrients->>'nutrient.dietaryfiber')::float8 * scale  as fiber_g
      from entries
  )`;

export function entriesParams(accountId: string, from: string, to: string): unknown[] {
  return [accountId, from, to, accountId, from, to, accountId, from, to];
}
