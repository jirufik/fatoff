<script setup lang="ts">
import type { PageDto, PlanDto } from '@fatoff/contracts'

/**
 * Сохранённые планы.
 *
 * Отдельный раздел, а не хвост конструктора: план живёт дольше сборки, к нему
 * возвращаются, и искать его среди настроек генератора неудобно. Отбор идёт по
 * названию и меткам, метки свободные — их придумывает человек.
 */
const api = useApi()
const route = useRoute()
const router = useRouter()
const { t, locale } = useI18n()
const id = route.params.id as string

const plans = ref<PlanDto[]>([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(20)
const search = ref('')
const chosenTags = ref<string[]>([])
const tags = ref<Array<{ tag: string; count: number }>>([])

const loading = ref(false)
const error = ref('')
const editing = ref<string | null>(null)
const draftName = ref('')
const draftTags = ref<string[]>([])

/** Управление метками: переименование и удаление меняют все планы сразу. */
const manageTags = ref(false)
const renaming = ref<string | null>(null)
const renameTo = ref('')
const notice = ref('')

async function load(): Promise<void> {
  loading.value = true
  error.value = ''
  try {
    const query = new URLSearchParams({ page: String(page.value), pageSize: String(pageSize.value) })
    if (search.value.trim()) query.set('search', search.value.trim())
    if (chosenTags.value.length > 0) query.set('tags', chosenTags.value.join(','))

    const result = await api.get<PageDto<PlanDto>>(`/accounts/${id}/planner/plans?${query}`)
    plans.value = result.items
    total.value = result.total
  } catch (caught) {
    error.value = errorMessage(caught)
    plans.value = []
    total.value = 0
  } finally {
    loading.value = false
  }
}

async function loadTags(): Promise<void> {
  tags.value = await api.get<Array<{ tag: string; count: number }>>(
    `/accounts/${id}/planner/plans/tags`,
  )
}

function toggleTag(tag: string): void {
  const at = chosenTags.value.indexOf(tag)
  if (at >= 0) chosenTags.value.splice(at, 1)
  else chosenTags.value.push(tag)
  page.value = 1
  void load()
}

function startEdit(plan: PlanDto): void {
  editing.value = plan.id
  draftName.value = plan.name
  draftTags.value = [...plan.tags]
}

async function saveEdit(plan: PlanDto): Promise<void> {
  try {
    await api.patch(`/accounts/${id}/planner/plans/${plan.id}`, {
      name: draftName.value,
      tags: draftTags.value,
    })
    editing.value = null
    await Promise.all([load(), loadTags()])
  } catch (caught) {
    error.value = errorMessage(caught)
  }
}

async function remove(plan: PlanDto): Promise<void> {
  await api.del(`/accounts/${id}/planner/plans/${plan.id}`)
  await Promise.all([load(), loadTags()])
}

async function renameTag(tag: string): Promise<void> {
  try {
    const result = await api.patch<{ changed: number }>(`/accounts/${id}/planner/plans/tags`, {
      from: tag,
      to: renameTo.value,
    })
    notice.value = t('plans.tag.renamed', { count: result.changed })
    renaming.value = null
    // выбранная метка могла переименоваться — отбор сбрасывается, иначе список
    // молча опустеет и будет непонятно, куда делись планы
    chosenTags.value = []
    await Promise.all([load(), loadTags()])
  } catch (caught) {
    error.value = errorMessage(caught)
  }
}

async function deleteTag(tag: string): Promise<void> {
  try {
    const result = await api.del<{ changed: number }>(
      `/accounts/${id}/planner/plans/tags/${encodeURIComponent(tag)}`,
    )
    notice.value = t('plans.tag.deleted', { count: result.changed })
    chosenTags.value = chosenTags.value.filter((entry) => entry !== tag)
    await Promise.all([load(), loadTags()])
  } catch (caught) {
    error.value = errorMessage(caught)
  }
}

/** Открыть план в конструкторе: он подхватит его из хранилища браузера. */
function openInBuilder(plan: PlanDto): void {
  sessionStorage.setItem('fatoff:open-plan', JSON.stringify(plan.plan))
  void router.push(`/accounts/${id}/planner`)
}

const pdfHref = (plan: PlanDto): string =>
  `/api/accounts/${id}/planner/plans/${plan.id}/pdf?lang=${locale.value}`

/** Поиск ждёт, пока перестанут печатать. */
let timer: ReturnType<typeof setTimeout> | null = null
watch(search, () => {
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => {
    page.value = 1
    void load()
  }, 350)
})
watch([page, pageSize], load)

onMounted(async () => {
  await Promise.all([load(), loadTags()])
})

const num = (value: number | null | undefined): string =>
  value === null || value === undefined ? '—' : value.toLocaleString('ru-RU')
</script>

<template>
  <div>
    <PageHead :title="t('nav.plans')" :back="`/accounts/${id}`">{{ t('plans.lede') }}</PageHead>

    <div v-if="error" class="alert alert--bad">{{ error }}</div>
    <div v-if="notice" class="alert alert--ok">{{ notice }}</div>

    <div class="card filters">
      <label class="filter filter--grow">
        <span>{{ t('common.search') }}</span>
        <input v-model="search" :placeholder="t('plans.searchPlaceholder')" />
      </label>

      <div v-if="tags.length > 0" class="filter filter--grow">
        <span>{{ t('plans.tags') }}</span>
        <div class="row row--wrap" style="gap: 0.3rem">
          <button
            v-for="entry in tags"
            :key="entry.tag"
            class="tag"
            :class="{ 'tag--on': chosenTags.includes(entry.tag) }"
            type="button"
            @click="toggleTag(entry.tag)"
          >
            #{{ entry.tag }}
            <span class="tag__count">{{ entry.count }}</span>
          </button>
          <button class="btn btn--small" type="button" @click="manageTags = !manageTags">
            <AppIcon name="edit" :size="13" /> {{ t('plans.tag.manage') }}
          </button>
        </div>
      </div>
    </div>

    <!-- ── управление метками ───────────────────────────────────────────── -->
    <section v-if="manageTags" class="card">
      <h3 style="margin-top: 0">{{ t('plans.tag.manage') }}</h3>
      <p class="tiny muted">{{ t('plans.tag.manage.note') }}</p>

      <p v-if="tags.length === 0" class="muted">{{ t('plans.tag.none') }}</p>

      <div v-for="entry in tags" :key="entry.tag" class="tag-row">
        <template v-if="renaming === entry.tag">
          <input v-model="renameTo" maxlength="40" class="tag-row__input" />
          <button class="btn btn--small btn--primary" type="button" @click="renameTag(entry.tag)">
            <AppIcon name="check" :size="13" /> {{ t('common.save') }}
          </button>
          <button class="btn btn--small" type="button" @click="renaming = null">
            {{ t('common.cancel') }}
          </button>
        </template>
        <template v-else>
          <span class="tag-row__name">
            #{{ entry.tag }}
            <span class="tiny muted">{{ entry.count }}</span>
          </span>
          <button
            class="btn btn--small"
            type="button"
            @click="((renaming = entry.tag), (renameTo = entry.tag))"
          >
            <AppIcon name="edit" :size="13" /> {{ t('plans.tag.rename') }}
          </button>
          <button class="btn btn--small btn--danger" type="button" @click="deleteTag(entry.tag)">
            <AppIcon name="trash" :size="13" /> {{ t('plans.tag.delete') }}
          </button>
        </template>
      </div>
    </section>

    <div v-if="loading" class="card"><span class="spinner" /> {{ t('common.loading') }}</div>
    <div v-else-if="plans.length === 0" class="card muted">
      {{ total === 0 && !search && chosenTags.length === 0 ? t('plans.empty') : t('plans.nothingForFilter') }}
    </div>

    <article v-for="plan in plans" v-else :key="plan.id" class="card plan">
      <div v-if="editing === plan.id" class="edit">
        <label class="filter filter--grow">
          <span>{{ t('common.name') }}</span>
          <input v-model="draftName" maxlength="120" />
        </label>
        <div class="filter filter--grow">
          <span>{{ t('plans.tags') }}</span>
          <TagField v-model="draftTags" :known="tags" />
        </div>
        <button class="btn btn--primary" type="button" @click="saveEdit(plan)">
          <AppIcon name="check" :size="14" /> {{ t('common.save') }}
        </button>
        <button class="btn" type="button" @click="editing = null">{{ t('common.cancel') }}</button>
      </div>

      <template v-else>
        <div class="row row--between row--wrap">
          <div class="grow">
            <h3 class="plan__name">
              <NuxtLink :to="`/accounts/${id}/plans/${plan.id}`">{{ plan.name }}</NuxtLink>
            </h3>
            <p class="tiny muted plan__meta">
              <span class="mono">{{ plan.from }} — {{ plan.to }}</span>
              · {{ plan.plan.summary.days }} {{ t('common.days') }}
              · {{ num(plan.plan.summary.avgEnergyKcal) }} {{ t('plans.avgKcal') }}
              · {{ t('plans.savedAt') }} {{ plan.createdAt.slice(0, 10) }}
            </p>
            <div v-if="plan.tags.length > 0" class="row row--wrap" style="gap: 0.25rem">
              <span v-for="tag in plan.tags" :key="tag" class="chip chip--mute">#{{ tag }}</span>
            </div>
          </div>

          <div class="row row--wrap" style="gap: 0.35rem">
            <NuxtLink class="btn btn--small btn--primary" :to="`/accounts/${id}/plans/${plan.id}`">
              <AppIcon name="eye" :size="13" /> {{ t('plans.open') }}
            </NuxtLink>
            <a class="btn btn--small" :href="pdfHref(plan)" download>
              <AppIcon name="save" :size="13" /> {{ t('plans.pdf') }}
            </a>
            <button class="btn btn--small" type="button" @click="openInBuilder(plan)">
              <AppIcon name="play" :size="13" /> {{ t('plans.openInBuilder') }}
            </button>
            <button class="btn btn--small" type="button" @click="startEdit(plan)">
              {{ t('plans.rename') }}
            </button>
            <button class="btn btn--small btn--danger" type="button" @click="remove(plan)">
              <AppIcon name="trash" :size="13" />
            </button>
          </div>
        </div>

        <MacroSet
          :protein="plan.plan.summary.avgProteinG"
          :carbs="plan.plan.summary.avgCarbsG"
          :fat="plan.plan.summary.avgFatG"
          :fiber="plan.plan.summary.avgFiberG"
          :digits="1"
        />
      </template>
    </article>

    <DataPager v-model:page="page" v-model:page-size="pageSize" :total="total" />
  </div>
</template>

<style scoped>
.plan {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
.plan__name {
  margin: 0 0 0.15rem;
  font-size: 1rem;
}
.plan__meta {
  margin: 0 0 0.35rem;
}

.tag {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  min-height: 28px;
  padding: 0 0.6rem;
  border: 1px solid var(--line);
  border-radius: 999px;
  background: var(--surface);
  color: var(--ink-2);
  font: inherit;
  font-size: 0.8rem;
  cursor: pointer;
}
.tag:hover {
  border-color: color-mix(in oklab, var(--accent) 45%, var(--line));
  color: var(--ink);
}
.tag--on {
  border-color: var(--accent);
  background: var(--accent-bg);
  color: var(--accent-ink);
}
.tag__count {
  font-family: var(--font-mono);
  font-size: 0.7rem;
  color: var(--ink-3);
}

.edit {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 0.6rem;
}

.plan__name a {
  color: inherit;
  text-decoration: none;
}
.plan__name a:hover {
  color: var(--accent);
}

.tag-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.4rem;
  padding: 0.35rem 0;
  border-top: 1px solid var(--line-soft);
}
.tag-row__name {
  flex: 1 1 8rem;
  min-width: 0;
  overflow-wrap: anywhere;
}
.tag-row__input {
  flex: 1 1 8rem;
  min-width: 0;
}
</style>
