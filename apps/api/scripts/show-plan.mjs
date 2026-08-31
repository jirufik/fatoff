/**
 * Показывает нормы, пул и сгенерированную неделю по живым данным.
 *
 * Тесты проверяют правила, а этот прогон показывает результат: меню, которое
 * человек правда увидит, с настоящими продуктами и граммовками. Полезно, когда
 * поменялись веса подбора или отбор пула — по числам в тестах этого не видно.
 *
 *   node --env-file=../../.env scripts/show-plan.mjs
 */
import { NestFactory } from '@nestjs/core';

const { AppModule } = await import('../dist/app.module.js');
const { PlannerService } = await import('../dist/modules/planner/planner.service.js');
const { EntityManager, RequestContext } = await import('@mikro-orm/postgresql');

const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
const planner = app.get(PlannerService);
const em = app.get(EntityManager);

await RequestContext.create(em, async () => {
  const [account] = await em.getConnection().execute(
    'select id, label from account order by (select count(*) from health_daily h where h.account_id = account.id) desc limit 1',
  );
  console.log('аккаунт:', account.id);

  console.time('нормы');
  const targets = await planner.targets(account.id);
  console.timeEnd('нормы');
  console.log('профиль:', targets.profile);
  console.log('расход:', targets.expenditure);
  console.log('дефицит:', targets.deficitKcal);
  console.log('расчёт:', targets.computed);
  console.log('YAZIO :', targets.yazio);
  console.log('разница:', targets.diff);
  console.log('белок за приём:', targets.proteinPerMealG);
  console.log('энергодоступность:', targets.energyAvailability);
  console.log('предупреждения:', targets.warnings);

  console.time('пул');
  const pool = await planner.pool(account.id);
  console.timeEnd('пул');
  console.log('продуктов в пуле:', pool.length);
  console.table(pool.slice(0, 8).map((i) => ({
    name: i.name.slice(0, 34), meals: i.meals.join(','), n: i.entries,
    typical: i.typicalAmount, kcal: Math.round(i.per.energyKcal * i.typicalAmount),
    protein: +(i.per.proteinG * i.typicalAmount).toFixed(1),
  })));

  console.time('неделя');
  const plan = await planner.generate(account.id, {
    from: '2026-08-31', to: '2026-09-06',
    training: { mode: 'current' },
    seed: 42,
  });
  console.timeEnd('неделя');

  console.log('\nсводка:', plan.summary);
  console.log('предупреждения плана:', plan.warnings.map((x) => x.code));

  for (const day of plan.days) {
    const w = day.workouts.map((x) => `${x.type} ${x.durationMin}м/${x.energyKcal}ккал`).join(', ') || 'отдых';
    console.log(`\n${day.date} (${['','пн','вт','ср','чт','пт','сб','вс'][day.weekday]}) — ${w}`);
    console.log(`  цель ${day.targets.energyKcal} ккал / Б${day.targets.proteinG} У${day.targets.carbsG} Ж${day.targets.fatG} К${day.targets.fiberG}`);
    console.log(`  итог ${day.totals.energyKcal} ккал / Б${day.totals.proteinG} У${day.totals.carbsG} Ж${day.totals.fatG} К${day.totals.fiberG}, EA ${day.energyAvailability}`);
    for (const meal of day.meals) {
      // сервер фраз не сочиняет (D-044): здесь печатается ключ, а не подпись
      const from = meal.comboFrom ? `комплект от ${meal.comboFrom}` : 'собран из блюд';
      console.log(`   ${meal.meal} (цель ${meal.targetKcal}, ${from}): ${meal.totals.energyKcal} ккал, Б${meal.totals.proteinG}`);
      for (const item of meal.items) {
        console.log(`     — ${item.name.slice(0, 40)} ${item.amount} ${item.unit}: ${item.energyKcal} ккал Б${item.proteinG}`);
      }
    }
    if (day.warnings.length) {
      console.log('   ! ' + day.warnings.map((x) => `${x.code} ${JSON.stringify(x.params)}`).join('\n   ! '));
    }
  }

  // повторяемость: то же зерно — тот же план
  const again = await planner.generate(account.id, {
    from: '2026-08-31', to: '2026-09-06', training: { mode: 'current' }, seed: 42,
  });
  console.log('\nодно зерно — один план:', JSON.stringify(again.days) === JSON.stringify(plan.days));
});

await app.close();
