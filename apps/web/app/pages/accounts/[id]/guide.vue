<script setup lang="ts">
import { TRAINING_MODE_TITLES } from '@fatoff/contracts'
import type { AlgorithmSettingsDto, SettingGroupSpec, SettingSpec, TargetSettingsDto, TargetsDto } from '@fatoff/contracts'

/**
 * Как это работает — объяснение генератора человеческим языком.
 *
 * Таблица настроек строится из того же справочника, что и форма конструктора
 * (D-027): объяснение и применение не могут разойтись, потому что читают один
 * список. Числа в примерах — её собственные, подставляются из расчёта норм.
 */
const api = useApi()
const { t, message, pick } = useI18n()
const route = useRoute()
const id = route.params.id as string

interface Schema {
  groups: SettingGroupSpec[]
  settings: SettingSpec[]
  defaults: { targets: TargetSettingsDto; algorithm: AlgorithmSettingsDto }
}

const schema = ref<Schema | null>(null)
const targets = ref<TargetsDto | null>(null)
const error = ref('')
const open = ref<Record<string, boolean>>({})

const grouped = computed(() =>
  (schema.value?.groups ?? []).map((group) => ({
    group,
    settings: (schema.value?.settings ?? []).filter((item) => item.group === group.key),
  })),
)

onMounted(async () => {
  try {
    ;[schema.value, targets.value] = await Promise.all([
      api.get<Schema>(`/accounts/${id}/planner/settings`),
      api.get<TargetsDto>(`/accounts/${id}/planner/targets`),
    ])
  } catch (caught) {
    error.value = errorMessage(caught)
  }
})

const num = (value: number | null | undefined, digits = 0): string =>
  value === null || value === undefined
    ? '—'
    : value.toLocaleString('ru-RU', { maximumFractionDigits: digits })

/** Положение отметки на шкале энергодоступности, 0–60 ккал/кг. */
const eaX = (value: number | null | undefined): number =>
  Math.max(0, Math.min(100, ((value ?? 0) / 60) * 100))

const SOURCES = [
  { key: 'guide.source.who', url: 'https://www.ncbi.nlm.nih.gov/books/NBK566046/' },
  { key: 'guide.source.issn', url: 'https://link.springer.com/article/10.1186/s12970-017-0177-8' },
  { key: 'guide.source.ioc', url: 'https://pubmed.ncbi.nlm.nih.gov/29773536/' },
  { key: 'guide.source.mifflin', url: 'https://pubmed.ncbi.nlm.nih.gov/2305711/' },
  { key: 'guide.source.schoenfeld', url: 'https://www.tandfonline.com/doi/full/10.1186/s12970-018-0215-1' },
  { key: 'guide.source.garthe', url: 'https://pubmed.ncbi.nlm.nih.gov/21558571/' },
  { key: 'guide.source.fiber', url: 'https://pubmed.ncbi.nlm.nih.gov/26514720/' },
]

/** Значение по умолчанию словами: «по формуле», «включено», число. */
const defaultLabel = (spec: SettingSpec): string =>
  spec.default === null
    ? t('guide.settings.default.formula')
    : spec.default === true
      ? t('guide.settings.default.on')
      : spec.default === false
        ? t('guide.settings.default.off')
        : String(spec.default)
</script>

<template>
  <div>
    <PageHead :title="t('nav.guide')" :back="`/accounts/${id}`">
      {{ t('guide.lede') }}
    </PageHead>

    <div v-if="error" class="alert alert--bad">{{ error }}</div>

    <!-- ── коротко ────────────────────────────────────────────────────────── -->
    <section class="card">
      <h2><AppIcon name="info" :size="16" /> {{ t('guide.brief') }}</h2>
      <p class="lede" style="margin-bottom: 1rem">
        {{ t('guide.brief.lede') }}
      </p>

      <div class="brief">
        <div class="brief__item">
          <h3>{{ t('guide.brief.1.title') }}</h3>
          <p class="note">
            {{
              t('guide.brief.1.note', {
                burn: num(targets?.expenditure.totalKcal),
                target: num(targets?.computed.energyKcal),
              })
            }}
          </p>
        </div>

        <div class="brief__item">
          <h3>{{ t('guide.brief.2.title') }}</h3>
          <p class="note">
            {{ t('guide.brief.2.note') }}
          </p>
        </div>

        <div class="brief__item">
          <h3>{{ t('guide.brief.3.title') }}</h3>
          <p class="note">
            {{ t('guide.brief.3.note') }}
          </p>
        </div>

        <div class="brief__item">
          <h3>{{ t('guide.brief.4.title') }}</h3>
          <p class="note">
            {{ t('guide.brief.4.note') }}
          </p>
        </div>

        <div class="brief__item">
          <h3>{{ t('guide.brief.5.title') }}</h3>
          <p class="note">
            {{ t('guide.brief.5.note') }}
          </p>
        </div>

        <div class="brief__item">
          <h3>{{ t('guide.brief.6.title') }}</h3>
          <p class="note">
            {{ t('guide.brief.6.note') }}
          </p>
        </div>
      </div>
    </section>

    <!-- ── поток ──────────────────────────────────────────────────────────── -->
    <section class="card">
      <h2><AppIcon name="sliders" :size="16" /> {{ t('guide.flow') }}</h2>
      <p class="note">
        {{ t('guide.flow.lede') }}
      </p>

      <div class="figure">
        <svg viewBox="0 0 720 200" class="flow" role="img" :aria-label="t('guide.alt.flow')">
          <g class="flow__box">
            <rect x="4" y="16" width="150" height="52" rx="8" />
            <text x="79" y="38">{{ t('guide.flow.sources') }}</text>
            <text x="79" y="55" class="flow__sub">{{ t('guide.flow.sources.note') }}</text>
          </g>
          <g class="flow__box">
            <rect x="190" y="16" width="150" height="52" rx="8" />
            <text x="265" y="38">{{ t('guide.flow.targets') }}</text>
            <text x="265" y="55" class="flow__sub">{{ t('guide.flow.targets.note') }}</text>
          </g>
          <g class="flow__box">
            <rect x="376" y="16" width="150" height="52" rx="8" />
            <text x="451" y="38">{{ t('guide.flow.training') }}</text>
            <text x="451" y="55" class="flow__sub">{{ t('guide.flow.training.note') }}</text>
          </g>
          <g class="flow__box">
            <rect x="562" y="16" width="150" height="52" rx="8" />
            <text x="637" y="38">{{ t('guide.flow.day') }}</text>
            <text x="637" y="55" class="flow__sub">{{ t('guide.flow.day.note') }}</text>
          </g>

          <g class="flow__box">
            <rect x="190" y="120" width="150" height="52" rx="8" />
            <text x="265" y="142">{{ t('guide.flow.pool') }}</text>
            <text x="265" y="159" class="flow__sub">{{ t('guide.flow.pool.note') }}</text>
          </g>
          <g class="flow__box">
            <rect x="376" y="120" width="150" height="52" rx="8" />
            <text x="451" y="142">{{ t('guide.flow.menu') }}</text>
            <text x="451" y="159" class="flow__sub">{{ t('guide.flow.menu.note') }}</text>
          </g>
          <g class="flow__box flow__box--check">
            <rect x="562" y="120" width="150" height="52" rx="8" />
            <text x="637" y="142">{{ t('guide.flow.checks') }}</text>
            <text x="637" y="159" class="flow__sub">{{ t('guide.flow.checks.note') }}</text>
          </g>

          <g class="flow__arrow">
            <path d="M158 42h28" />
            <path d="M344 42h28" />
            <path d="M530 42h28" />
            <path d="M637 72v26h-186v18" />
            <path d="M344 146h28" />
            <path d="M265 98v18" />
            <path d="M530 146h28" />
          </g>
          <text x="612" y="112" class="flow__note">{{ t('guide.flow.carried') }}</text>
        </svg>
      </div>
    </section>

    <!-- ── нормы ──────────────────────────────────────────────────────────── -->
    <section class="card">
      <h2><AppIcon name="target" :size="16" /> {{ t('guide.targets') }}</h2>

      <h3 class="pane__title">{{ t('guide.targets.spend') }}</h3>
      <p class="note">
        {{ t('guide.targets.spend.note') }}
      </p>
      <pre class="formula">{{
        t('guide.f.burn', {
          total: num(targets?.expenditure.totalKcal),
          basal: num(targets?.expenditure.basalKcal),
          active: num(targets?.expenditure.activeKcal),
        })
      }}</pre>
      <p class="note">
        {{ t('guide.targets.mifflin', { mifflin: num(targets?.expenditure.mifflinKcal) }) }}
      </p>
      <pre class="formula">{{ t('guide.f.mifflin') }}</pre>

      <h3 class="pane__title">{{ t('guide.targets.deduct') }}</h3>
      <p class="note">
        {{ t('guide.targets.deduct.note') }}
      </p>
      <pre class="formula">{{
        t('guide.f.deficit', {
          deficit: num(targets?.deficitKcal),
          rate: targets?.lossRatePctPerWeek ?? '',
          weight: num(targets?.profile.weightKg, 1),
          target: num(targets?.computed.energyKcal),
        })
      }}</pre>
      <p class="note">
        {{ t('guide.targets.garthe') }}
      </p>

      <h3 class="pane__title">{{ t('guide.targets.split') }}</h3>
      <p class="note">
        {{ t('guide.targets.split.note') }}
      </p>
      <pre class="formula">{{
        t('guide.f.macros', {
          proteinPerKg: schema?.defaults.targets.proteinPerKg ?? '',
          fatPerKg: schema?.defaults.targets.fatPerKg ?? '',
          fiberPer1000: schema?.defaults.targets.fiberPer1000Kcal ?? '',
          weight: num(targets?.profile.weightKg, 1),
          protein: num(targets?.computed.proteinG),
          fat: num(targets?.computed.fatG),
          carbs: num(targets?.computed.carbsG),
          fiber: num(targets?.computed.fiberG),
        })
      }}</pre>
      <p class="note">
        {{ t('guide.targets.split.four') }}
      </p>

      <h3 class="pane__title">{{ t('guide.targets.perMeal') }}</h3>
      <p class="note">
        {{ t('guide.targets.perMeal.note', { value: num(targets?.proteinPerMealG) }) }}
      </p>
    </section>

    <!-- ── энергодоступность ──────────────────────────────────────────────── -->
    <section class="card">
      <h2><AppIcon name="flame" :size="16" /> {{ t('guide.ea') }}</h2>
      <p class="note">
        {{ t('guide.ea.note') }}
      </p>
      <pre class="formula">{{
        t('guide.f.ea', {
          lean: num(targets?.profile.leanMassKg, 1),
          weight: num(targets?.profile.weightKg, 1),
          fat: num(targets?.profile.bodyFatPct, 1),
          now: num(targets?.energyAvailability.current, 1),
          planned: num(targets?.energyAvailability.atTarget, 1),
          threshold: targets?.energyAvailability.threshold ?? 30,
          optimal: targets?.energyAvailability.optimal ?? 45,
        })
      }}</pre>

      <div class="figure">
        <svg viewBox="0 0 720 120" class="scale" role="img" :aria-label="t('guide.alt.scale')">
          <rect x="10" y="40" width="700" height="18" rx="9" class="scale__track" />
          <rect x="10" y="40" :width="700 * 0.5" height="18" rx="9" class="scale__low" />
          <rect x="10" y="40" width="0" height="18" />

          <line x1="360" y1="30" x2="360" y2="70" class="scale__tick" />
          <text x="360" y="24" class="scale__label">{{ t('guide.ea.threshold') }}</text>
          <line x1="535" y1="30" x2="535" y2="70" class="scale__tick" />
          <text x="535" y="24" class="scale__label">{{ t('guide.ea.optimal') }}</text>

          <g v-if="targets?.energyAvailability.current !== null">
            <circle :cx="10 + 7 * eaX(targets?.energyAvailability.current)" cy="49" r="8" class="scale__now" />
            <text
              :x="10 + 7 * eaX(targets?.energyAvailability.current)"
              y="88"
              class="scale__value"
            >
              {{ t('guide.ea.now', { value: num(targets?.energyAvailability.current, 1) }) }}
            </text>
          </g>
          <g v-if="targets?.energyAvailability.atTarget !== null">
            <circle
              :cx="10 + 7 * eaX(targets?.energyAvailability.atTarget)"
              cy="49"
              r="6"
              class="scale__goal"
            />
            <text :x="10 + 7 * eaX(targets?.energyAvailability.atTarget)" y="108" class="scale__value">
              {{ t('guide.ea.plan', { value: num(targets?.energyAvailability.atTarget, 1) }) }}
            </text>
          </g>

          <text x="10" y="88" class="scale__end">0</text>
          <text x="700" y="88" class="scale__end">60</text>
        </svg>
      </div>

      <p class="note">
        {{ t('guide.ea.below') }}
      </p>
      <p class="note">
        {{ t('guide.ea.why') }}
      </p>
    </section>

    <!-- ── меню ───────────────────────────────────────────────────────────── -->
    <section class="card">
      <h2><AppIcon name="meal" :size="16" /> {{ t('guide.menu') }}</h2>

      <h3 class="pane__title">{{ t('guide.menu.step1') }}</h3>
      <p class="note">
        {{ t('guide.menu.step1.note') }}
      </p>

      <h3 class="pane__title">{{ t('guide.menu.step2') }}</h3>
      <p class="note">
        {{ t('guide.menu.step2.note') }}
      </p>
      <pre class="formula">{{ t('guide.f.mealTarget', { floor: num(targets?.proteinPerMealG) }) }}</pre>

      <h3 class="pane__title">{{ t('guide.menu.step3') }}</h3>
      <p class="note">
        {{ t('guide.menu.step3.note') }}
      </p>

      <div class="figure">
        <svg viewBox="0 0 720 190" class="beam" role="img" :aria-label="t('guide.alt.beam')">
          <text x="10" y="18" class="beam__step">{{ t('guide.menu.beam.empty') }}</text>
          <text x="200" y="18" class="beam__step">{{ t('guide.menu.beam.first') }}</text>
          <text x="410" y="18" class="beam__step">{{ t('guide.menu.beam.second') }}</text>
          <text x="600" y="18" class="beam__step">{{ t('guide.menu.beam.third') }}</text>

          <circle cx="40" cy="95" r="9" class="beam__node beam__node--on" />

          <g class="beam__edge">
            <path d="M49 95 210 45M49 95 210 95M49 95 210 145" />
            <path d="M229 45 420 30M229 45 420 75" />
            <path d="M229 95 420 120" />
            <path d="M229 145 420 165" />
            <path d="M439 30 620 30M439 120 620 105" />
          </g>

          <circle cx="220" cy="45" r="9" class="beam__node beam__node--on" />
          <circle cx="220" cy="95" r="9" class="beam__node beam__node--on" />
          <circle cx="220" cy="145" r="9" class="beam__node beam__node--off" />
          <circle cx="430" cy="30" r="9" class="beam__node beam__node--on" />
          <circle cx="430" cy="75" r="9" class="beam__node beam__node--off" />
          <circle cx="430" cy="120" r="9" class="beam__node beam__node--on" />
          <circle cx="430" cy="165" r="9" class="beam__node beam__node--off" />
          <circle cx="630" cy="30" r="10" class="beam__node beam__node--best" />
          <circle cx="630" cy="105" r="9" class="beam__node beam__node--on" />

          <text x="655" y="35" class="beam__label">{{ t('guide.menu.beam.best') }}</text>
          <text x="10" y="180" class="beam__legend">
            {{ t('guide.menu.beam.legend') }}
          </text>
        </svg>
      </div>

      <p class="note">
        {{ t('guide.menu.cost') }}
      </p>
      <pre class="formula">{{ t('guide.f.cost') }}</pre>
      <p class="note">
        {{ t('guide.menu.relative') }}
      </p>

      <h3 class="pane__title">{{ t('guide.menu.step4') }}</h3>
      <p class="note">
        {{ t('guide.menu.step4.note') }}
      </p>

      <h3 class="pane__title">{{ t('guide.menu.step5') }}</h3>
      <p class="note">
        {{ t('guide.menu.step5.note') }}
      </p>

      <h3 class="pane__title">{{ t('guide.menu.step6') }}</h3>
      <p class="note">
        {{ t('guide.menu.step6.note') }}
      </p>
    </section>

    <!-- ── тренировки ─────────────────────────────────────────────────────── -->
    <section class="card">
      <h2><AppIcon name="dumbbell" :size="16" /> {{ t('guide.training') }}</h2>
      <p class="note">
        {{ t('guide.training.note') }}
      </p>

      <div class="table-wrap">
        <table class="data">
          <thead>
            <tr>
              <th>{{ t('guide.training.col.mode') }}</th>
              <th>{{ t('guide.training.col.count') }}</th>
              <th>{{ t('guide.training.col.who') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><strong>{{ pick(TRAINING_MODE_TITLES.current) }}</strong></td>
              <td>{{ t('guide.training.current.count') }}</td>
              <td class="tiny muted">{{ t('guide.training.current.who') }}</td>
            </tr>
            <tr>
              <td><strong>{{ pick(TRAINING_MODE_TITLES.who) }}</strong></td>
              <td>{{ t('guide.training.who.count') }}</td>
              <td class="tiny muted">{{ t('guide.training.who.who') }}</td>
            </tr>
            <tr>
              <td><strong>{{ pick(TRAINING_MODE_TITLES.manual) }}</strong></td>
              <td>{{ t('guide.training.manual.count') }}</td>
              <td class="tiny muted">{{ t('guide.training.manual.who') }}</td>
            </tr>
            <tr>
              <td><strong>{{ pick(TRAINING_MODE_TITLES.goal) }}</strong></td>
              <td>{{ t('guide.training.goal.count') }}</td>
              <td class="tiny muted">{{ t('guide.training.goal.who') }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <h3 class="pane__title">{{ t('guide.training.rules') }}</h3>
      <p class="note">
        {{ t('guide.training.rules.note') }}
      </p>
      <ul class="rules">
        <li><strong>{{ t('guide.training.rule1') }}</strong> {{ t('guide.training.rule1.note') }}</li>
        <li>
          <strong>{{ t('guide.training.rule2') }}</strong> {{ t('guide.training.rule2.note') }}
        </li>
        <li>
          <strong>{{ t('guide.training.rule3') }}</strong> {{ t('guide.training.rule3.note') }}
        </li>
        <li>
          <strong>{{ t('guide.training.rule4') }}</strong> {{ t('guide.training.rule4.note') }}
        </li>
      </ul>
      <p class="note">
        {{ t('guide.training.hiit') }}
      </p>
    </section>

    <!-- ── настройки ──────────────────────────────────────────────────────── -->
    <section v-if="schema" class="card">
      <h2><AppIcon name="sliders" :size="16" /> {{ t('guide.settings') }}</h2>
      <p class="note">
        {{ t('guide.settings.lede', { count: schema.settings.length }) }}
      </p>

      <div v-for="entry in grouped" :key="entry.group.key" class="doc-group">
        <button class="doc-group__head" type="button" @click="open[entry.group.key] = !open[entry.group.key]">
          <span class="day__arrow">{{ open[entry.group.key] ? '▾' : '▸' }}</span>
          <strong>{{ pick(entry.group.title) }}</strong>
          <span class="tiny muted">{{ entry.settings.length }}</span>
        </button>

        <div v-if="open[entry.group.key]" class="doc-group__body">
          <p class="note">{{ pick(entry.group.description) }}</p>
          <dl class="doc-list">
            <template v-for="spec in entry.settings" :key="spec.key">
              <dt>
                {{ pick(spec.title) }}
                <span v-if="spec.unit" class="tiny muted">, {{ pick(spec.unit) }}</span>
                <span class="chip chip--mute">
                  {{ spec.default === null ? 'по формуле' : spec.default === true ? 'включено' : spec.default === false ? 'выключено' : spec.default }}
                </span>
                <span v-if="!spec.advanced" class="chip chip--info">{{ t('guide.settings.visible') }}</span>
              </dt>
              <dd>
                <p class="note">{{ pick(spec.description) }}</p>
                <p v-if="spec.source" class="tiny source">
                  <a v-if="spec.sourceUrl" :href="spec.sourceUrl" target="_blank" rel="noopener noreferrer">
                    {{ pick(spec.source) }}<AppIcon name="external" :size="10" />
                  </a>
                  <template v-else>{{ pick(spec.source) }}</template>
                </p>
              </dd>
            </template>
          </dl>
        </div>
      </div>
    </section>

    <!-- ── границы ────────────────────────────────────────────────────────── -->
    <section class="card">
      <h2><AppIcon name="info" :size="16" /> {{ t('guide.limits') }}</h2>
      <ul class="rules">
        <li>
          <strong>{{ t('guide.limits.1') }}</strong> {{ t('guide.limits.1.note') }}
        </li>
        <li>
          <strong>{{ t('guide.limits.2') }}</strong> {{ t('guide.limits.2.note') }}
        </li>
        <li>
          <strong>{{ t('guide.limits.3') }}</strong> {{ t('guide.limits.3.note') }}
        </li>
        <li>
          <strong>{{ t('guide.limits.4') }}</strong> {{ t('guide.limits.4.note') }}
        </li>
        <li>
          <strong>{{ t('guide.limits.5') }}</strong> {{ t('guide.limits.5.note') }}
        </li>
      </ul>
    </section>

    <!-- ── источники ──────────────────────────────────────────────────────── -->
    <section class="card">
      <h2><AppIcon name="bookmark" :size="16" /> {{ t('guide.sources') }}</h2>
      <p class="note">{{ t('guide.sources.lede') }}</p>
      <ul class="sources">
        <li v-for="source in SOURCES" :key="source.url">
          <a :href="source.url" target="_blank" rel="noopener noreferrer">
            {{ t(source.key) }}<AppIcon name="external" :size="11" />
          </a>
        </li>
      </ul>
    </section>
  </div>
</template>

<style scoped>
h2 {
  display: flex;
  align-items: center;
  gap: 0.45rem;
}
.pane__title {
  font-size: 0.82rem;
  font-weight: 600;
  color: var(--ink-3);
  margin: 1.3rem 0 0.4rem;
}
.note {
  color: var(--ink-2);
  font-size: 0.9rem;
  margin: 0 0 0.7rem;
  max-width: 68ch;
}
.note:last-child {
  margin-bottom: 0;
}

.brief {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(17rem, 100%), 1fr));
  gap: 1rem 1.5rem;
}
.brief__item h3 {
  font-size: 0.92rem;
  margin: 0 0 0.3rem;
}

.formula {
  font-family: var(--font-mono);
  font-size: 0.8rem;
  line-height: 1.7;
  margin: 0 0 0.9rem;
  padding: 0.7rem 0.85rem;
  background: var(--sunk);
  border-left: 3px solid var(--accent);
  border-radius: var(--radius-xs);
  overflow-x: auto;
  white-space: pre;
}

.figure {
  margin: 0.8rem 0 1rem;
  padding: 0.6rem;
  border: 1px solid var(--line-soft);
  border-radius: var(--radius-sm);
  background: var(--sunk);
  overflow-x: auto;
}
.figure svg {
  display: block;
  width: 100%;
  min-width: 30rem;
  height: auto;
}

/*
 * На телефоне формула переносится, а схема сжимается.
 *
 * Формула шириной в 573 пикселя внутри трёхсотпиксельного экрана — это своя
 * горизонтальная прокрутка на каждый блок: прочитать её, таская пальцем взад и
 * вперёд, нельзя. Перенос ломает выравнивание, но выравнивание без чтения
 * бесполезно. Схеме `min-width` не нужен вовсе: она векторная и читается
 * уменьшенной.
 */
@media (max-width: 46rem) {
  .formula {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    font-size: 0.74rem;
    line-height: 1.6;
  }
  .figure svg {
    min-width: 0;
  }
}

/* схема потока */
.flow__box rect {
  fill: var(--surface);
  stroke: var(--line);
}
.flow__box text {
  fill: var(--ink);
  font-size: 13px;
  font-weight: 600;
  text-anchor: middle;
  font-family: inherit;
}
.flow__box .flow__sub {
  fill: var(--ink-3);
  font-size: 11px;
  font-weight: 400;
}
.flow__box--check rect {
  stroke: var(--accent);
}
.flow__arrow path {
  fill: none;
  stroke: var(--ink-3);
  stroke-width: 1.5;
  marker-end: none;
}
.flow__note {
  fill: var(--ink-3);
  font-size: 11px;
  text-anchor: end;
}

/* шкала энергодоступности */
.scale__track {
  fill: var(--line-soft);
}
.scale__low {
  fill: color-mix(in oklab, var(--bad) 30%, var(--line-soft));
}
.scale__tick {
  stroke: var(--ink-3);
  stroke-width: 1.5;
  stroke-dasharray: 3 3;
}
.scale__label,
.scale__end {
  fill: var(--ink-3);
  font-size: 11px;
  text-anchor: middle;
}
.scale__value {
  fill: var(--ink);
  font-size: 12px;
  font-weight: 600;
  text-anchor: middle;
}
.scale__now {
  fill: var(--bad);
  stroke: var(--surface);
  stroke-width: 2;
}
.scale__goal {
  fill: var(--ok);
  stroke: var(--surface);
  stroke-width: 2;
}

/* схема поиска */
.beam__step {
  fill: var(--ink-3);
  font-size: 11px;
  font-family: var(--font-mono);
}
.beam__edge path {
  fill: none;
  stroke: var(--line);
  stroke-width: 1.5;
}
.beam__node--on {
  fill: var(--accent);
}
.beam__node--off {
  fill: none;
  stroke: var(--line);
  stroke-width: 1.5;
}
.beam__node--best {
  fill: var(--ok);
}
.beam__label {
  fill: var(--ink);
  font-size: 12px;
  font-weight: 600;
}
.beam__legend {
  fill: var(--ink-3);
  font-size: 11px;
}

.rules {
  margin: 0 0 0.7rem;
  padding-left: 1.1rem;
  color: var(--ink-2);
  font-size: 0.9rem;
  max-width: 68ch;
}
.rules li {
  margin-bottom: 0.4rem;
}
.rules strong {
  color: var(--ink);
}

.doc-group {
  border-top: 1px solid var(--line-soft);
}
.doc-group__head {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  width: 100%;
  padding: 0.6rem 0;
  border: none;
  background: none;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.day__arrow {
  color: var(--ink-3);
  font-size: 0.75rem;
}
.doc-group__body {
  padding-bottom: 0.8rem;
}
.doc-list {
  margin: 0.5rem 0 0;
}
.doc-list dt {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  flex-wrap: wrap;
  font-weight: 600;
  font-size: 0.88rem;
  margin-top: 0.8rem;
}
.doc-list dd {
  margin: 0.2rem 0 0;
}
.source a {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  color: var(--ink-3);
  text-decoration: none;
  border-bottom: 1px dashed color-mix(in oklab, var(--ink-3) 55%, transparent);
}
.source a:hover {
  color: var(--accent-ink);
  border-bottom-color: currentColor;
}

.sources {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(18rem, 100%), 1fr));
  gap: 0.35rem 1rem;
}
.sources li {
  min-width: 0;
  overflow-wrap: anywhere;
}
.sources a {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  font-size: 0.86rem;
  color: var(--accent-ink);
  text-decoration: none;
  border-bottom: 1px dashed color-mix(in oklab, var(--accent) 40%, transparent);
}
.sources a:hover {
  border-bottom-color: currentColor;
}
</style>
