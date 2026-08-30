<script setup lang="ts">
import type {
  AccountDto,
  AccountOverviewDto,
  DriveFetchDto,
  DriveSettingsDto,
  HealthFileDto,
  HealthImportDto,
  SyncRunDetailDto,
  SyncRunDto,
} from '@fatoff/contracts'

const api = useApi()
const { t, message } = useI18n()
const route = useRoute()
const router = useRouter()
const id = route.params.id as string

const account = ref<AccountDto | null>(null)
const overview = ref<AccountOverviewDto | null>(null)
const runs = ref<SyncRunDto[]>([])
const lastRun = ref<SyncRunDetailDto | null>(null)
const error = ref('')
const notice = ref('')

const from = ref('')
const to = ref('')
const allDays = ref(false)
const force = ref(false)
const starting = ref(false)

const healthFiles = ref<HealthFileDto[]>([])
const healthImports = ref<HealthImportDto[]>([])
const healthFile = ref('')
const startingHealth = ref(false)

const newLabel = ref('')
/** Время ежедневной синхронизации; пустая строка снимает расписание. */
const syncDailyAt = ref('')
const newPassword = ref('')
const newAccessToken = ref('')
const newRefreshToken = ref('')
const savingAccess = ref(false)

const active = computed(() =>
  runs.value.find((run) => run.status === 'queued' || run.status === 'running'),
)

const activeHealth = computed(() =>
  healthImports.value.find((item) => item.status === 'queued' || item.status === 'running'),
)

const healthPercent = computed(() => {
  const item = activeHealth.value
  if (!item || item.sizeBytes === 0) return 0
  return Math.round((item.bytesRead / item.sizeBytes) * 100)
})

async function loadAccount(): Promise<void> {
  account.value = await api.get<AccountDto>(`/accounts/${id}`)
  if (!newLabel.value) newLabel.value = account.value.label ?? ''
  syncDailyAt.value = account.value.syncDailyAt ?? ''
}

async function loadOverview(): Promise<void> {
  overview.value = await api.get<AccountOverviewDto>(`/accounts/${id}/overview`)
}

async function loadRuns(): Promise<void> {
  runs.value = await api.get<SyncRunDto[]>(`/accounts/${id}/sync?limit=10`)
  const latest = runs.value[0]
  lastRun.value = latest ? await api.get<SyncRunDetailDto>(`/sync/${latest.id}`) : null
}

async function loadHealth(): Promise<void> {
  healthImports.value = await api.get<HealthImportDto[]>(`/accounts/${id}/health/imports?limit=5`)
}

// ── выгрузка из Google Drive ───────────────────────────────────────────────
const drive = ref<DriveSettingsDto | null>(null)
const driveFetches = ref<DriveFetchDto[]>([])
const driveBusy = ref(false)

async function loadDrive(): Promise<void> {
  ;[drive.value, driveFetches.value] = await Promise.all([
    api.get<DriveSettingsDto>(`/accounts/${id}/drive/settings`),
    api.get<DriveFetchDto[]>(`/accounts/${id}/drive/fetches?limit=5`),
  ])
}

async function saveDrive(): Promise<void> {
  if (!drive.value) return
  try {
    drive.value = await api.patch<DriveSettingsDto>(`/accounts/${id}/drive/settings`, {
      url: drive.value.url,
      dailyAt: drive.value.dailyAt,
      enabled: drive.value.enabled,
    })
    notice.value = t('common.saved')
  } catch (caught) {
    error.value = errorMessage(caught)
  }
}

/** Кнопка «Загрузить»: сходить в папку прямо сейчас. */
async function checkDrive(): Promise<void> {
  driveBusy.value = true
  error.value = ''
  try {
    await api.post<DriveFetchDto>(`/accounts/${id}/drive/check`)
    await Promise.all([loadDrive(), loadHealth()])
  } catch (caught) {
    error.value = errorMessage(caught)
  } finally {
    driveBusy.value = false
  }
}

const DRIVE_TONE: Record<string, string> = {
  imported: 'ok',
  same: 'mute',
  empty: 'mute',
  rejected: 'warn',
  failed: 'bad',
}

async function refresh(): Promise<void> {
  try {
    await Promise.all([
      loadAccount(),
      loadOverview(),
      loadRuns(),
      loadHealth(),
      loadDrive().catch(() => undefined),
    ])
  } catch (caught) {
    error.value = errorMessage(caught)
  }
}

/** Пока выгрузка идёт, страница опрашивает её раз в секунду (D-008). */
let timer: ReturnType<typeof setInterval> | null = null

function watchProgress(): void {
  if (timer) return
  timer = setInterval(async () => {
    await Promise.all([loadRuns().catch(() => undefined), loadHealth().catch(() => undefined)])
    if (!active.value && !activeHealth.value) {
      stopWatching()
      await refresh()
    }
  }, 1000)
}

function stopWatching(): void {
  if (timer) clearInterval(timer)
  timer = null
}

onMounted(async () => {
  await refresh()
  healthFiles.value = await api.get<HealthFileDto[]>('/health-files').catch(() => [])
  if (healthFiles.value.length > 0) healthFile.value = healthFiles.value[0].path
  if (active.value || activeHealth.value) watchProgress()
})

/** Загрузка выгрузки Apple Health: файл берётся с диска, а не через форму. */
async function startHealthImport(): Promise<void> {
  startingHealth.value = true
  error.value = ''
  notice.value = ''
  try {
    await api.post(`/accounts/${id}/health/imports`, { path: healthFile.value })
    await loadHealth()
    watchProgress()
  } catch (caught) {
    error.value = errorMessage(caught)
  } finally {
    startingHealth.value = false
  }
}
onUnmounted(stopWatching)

async function startSync(): Promise<void> {
  starting.value = true
  error.value = ''
  notice.value = ''
  try {
    await api.post(`/accounts/${id}/sync`, {
      from: from.value || undefined,
      to: to.value || undefined,
      allDays: allDays.value || undefined,
      force: force.value || undefined,
    })
    await loadRuns()
    watchProgress()
  } catch (caught) {
    error.value = errorMessage(caught)
  } finally {
    starting.value = false
  }
}

async function cancelSync(): Promise<void> {
  if (!active.value) return
  await api.post(`/sync/${active.value.id}/cancel`).catch(() => undefined)
}

/**
 * Метка, автосинхронизация и вход. Пароль и токен проверяются до записи, поэтому
 * сохранить неработающий доступ нельзя.
 */
/** Расписание сохраняется сразу — как и настройки Drive рядом. */
async function saveSchedule(): Promise<void> {
  if (!account.value) return
  try {
    account.value = await api.patch<AccountDto>(`/accounts/${id}`, {
      syncEnabled: account.value.syncEnabled,
      syncDailyAt: syncDailyAt.value.trim() || null,
    })
    syncDailyAt.value = account.value.syncDailyAt ?? ''
    notice.value = t('common.saved')
  } catch (caught) {
    error.value = errorMessage(caught)
  }
}

async function saveAccount(): Promise<void> {
  savingAccess.value = true
  error.value = ''
  notice.value = ''
  try {
    await api.patch(`/accounts/${id}`, {
      label: newLabel.value.trim() || null,
      syncEnabled: account.value?.syncEnabled,
      syncDailyAt: syncDailyAt.value.trim() || null,
      ...(newPassword.value ? { password: newPassword.value } : {}),
      ...(newAccessToken.value ? { accessToken: newAccessToken.value.trim() } : {}),
      ...(newRefreshToken.value ? { refreshToken: newRefreshToken.value.trim() } : {}),
    })
    newPassword.value = ''
    newAccessToken.value = ''
    newRefreshToken.value = ''
    notice.value = t('common.saved')
    await refresh()
  } catch (caught) {
    error.value = errorMessage(caught)
  } finally {
    savingAccess.value = false
  }
}

async function removeAccount(): Promise<void> {
  if (!deleteReady.value) return
  try {
    await api.del(`/accounts/${id}`)
    await router.push('/')
  } catch (caught) {
    error.value = errorMessage(caught)
  }
}


/**
 * Сводка раздела: когда в последний раз и что прибавилось.
 *
 * Берётся последний **удавшийся** прогон, а не просто последний: неудачная
 * попытка ничего не добавила, и показывать её как «синхронизировано» — врать.
 */
const lastDone = computed(() => runs.value.find((run) => run.status === 'done') ?? null)

const lastHealth = computed(
  () => healthImports.value.find((item) => item.status === 'done') ?? null,
)

/**
 * Удаление требует набрать слово.
 *
 * `confirm()` спрашивает «да или нет», а на такое действие «да» слишком легко
 * нажать: оно уносит годы выгруженного и не отменяется (D-065).
 */
const deleting = ref(false)
const deleteWord = ref('')
const deleteReady = computed(
  () => deleteWord.value.trim().toLowerCase() === t('danger.word').toLowerCase(),
)

const progressPercent = computed(() => {
  const run = active.value
  if (!run || run.daysTotal === 0) return run?.status === 'running' ? 5 : 0
  return Math.round((run.daysDone / run.daysTotal) * 100)
})

const when = (iso: string | null): string =>
  iso ? new Date(iso).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'medium' }) : '—'

const num = (value: number | null | undefined, digits = 0): string =>
  value === null || value === undefined
    ? '—'
    : value.toLocaleString('ru-RU', { maximumFractionDigits: digits })

const runChip = (status: string): string =>
  ({ done: 'ok', failed: 'bad', cancelled: 'warn', running: 'info', queued: 'mute' })[status] ??
  'mute'
</script>

<template>
  <div v-if="account">
    <PageHead :title="t('nav.sync')" :back="`/accounts/${id}`">{{ t('sync.lede') }}</PageHead>

    <div v-if="error" class="alert alert--bad">{{ error }}</div>
    <div v-if="notice" class="alert alert--ok">{{ notice }}</div>

    <!-- ── YAZIO ────────────────────────────────────────────────────────── -->
    <section class="card">
      <h2><AppIcon name="swap" :size="16" /> {{ t('sync.yazio') }}</h2>

      <div class="sum">
        <div class="sum__facts">
          <p class="sum__when">
            {{ t('sync.last') }}:
            <strong v-if="lastDone">{{ when(lastDone.finishedAt || lastDone.startedAt) }}</strong>
            <strong v-else class="muted">{{ t('sync.never') }}</strong>
          </p>
          <p class="sum__what tiny muted">
            <template v-if="lastDone">
              {{ t('sync.added.days', { count: lastDone.daysDone }) }} ·
            </template>
            {{
              account.syncEnabled && account.syncDailyAt
                ? t('sync.schedule.on', { time: account.syncDailyAt })
                : t('sync.schedule.off')
            }}
          </p>
        </div>
        <button class="btn btn--primary" :disabled="starting || !!active" @click="startSync">
          <span v-if="starting || active" class="spinner" />
          <AppIcon v-else name="swap" :size="14" />
          {{ t('sync.run') }}
        </button>
      </div>

      <template v-if="active">
      <div class="row row--between" style="margin-bottom: 0.4rem">
      <span>{{ active.phase || t('sync.progress') }}</span>
      <span class="mono tiny">
      {{
      t('sync.progress.count', {
      done: active.daysDone,
      total: active.daysTotal,
      requests: active.requests,
      })
      }}
      </span>
      </div>
      <div class="progress"><div class="progress__fill" :style="{ width: `${progressPercent}%` }" /></div>
      <div class="row" style="margin-top: 0.7rem">
      <button class="btn btn--small" @click="cancelSync">{{ t('sync.cancel') }}</button>
      <span class="tiny">{{ t('sync.cancel.note') }}</span>
      </div>
      </template>

      <details class="more">
        <summary>{{ t('sync.more') }}</summary>

        <div class="more__body">
          <div class="row row--wrap" style="align-items: flex-end; gap: 0.75rem">
            <label class="field" style="margin: 0; width: 12rem">
              <span>{{ t('sync.daily') }}</span>
              <input
                v-model="syncDailyAt"
                type="text"
                maxlength="5"
                placeholder="06:30"
                @change="saveSchedule"
              />
            </label>
            <label class="check" style="margin-bottom: 0.4rem">
              <input v-model="account.syncEnabled" type="checkbox" @change="saveSchedule" />
              {{ t('sync.account.auto') }}
            </label>
          </div>
          <p class="tiny muted" style="margin: 0.4rem 0 1rem">{{ t('sync.daily.note') }}</p>

          <h3 class="more__title">{{ t('sync.period') }}</h3>
          <div class="row row--wrap" style="align-items: flex-end; gap: 0.75rem">
          <label class="field" style="margin: 0; width: 10rem">
          <span>{{ t('common.from') }}</span>
          <DateField v-model="from" />
          </label>
          <label class="field" style="margin: 0; width: 10rem">
          <span>{{ t('common.to') }}</span>
          <DateField v-model="to" />
          </label>
          <button class="btn btn--primary" :disabled="starting" @click="startSync">
          <span v-if="starting" class="spinner" />
          {{ t('sync.start') }}
          </button>
          </div>

          <div class="row row--wrap" style="margin-top: 0.6rem; gap: 1rem">
          <label class="check">
          <input v-model="allDays" type="checkbox" />
          {{ t('sync.allDays') }}
          </label>
          <label class="check">
          <input v-model="force" type="checkbox" />
          {{ t('sync.force') }}
          </label>
          </div>
          <p class="tiny" style="margin: 0.3rem 0 0">
          {{ t('sync.hint') }}</p>

          <h3 class="more__title">{{ t('sync.access') }}</h3>
          <div class="row row--wrap" style="margin-bottom: 0.6rem">
          <span class="chip" :class="account.authMethod === 'password' ? 'chip--info' : 'chip--mute'">
          {{
          account.authMethod === 'password'
          ? t('sync.account.byPassword')
          : t('sync.account.byToken')
          }}
          </span>
          <span class="tiny">
          {{
          account.authMethod === 'password'
          ? t('sync.account.byPassword.note')
          : t('sync.account.byToken.note')
          }}
          </span>
          </div>

          <template v-if="account.authMethod === 'password'">
          <label class="field" style="margin: 0 0 0.6rem">
          <span>{{ t('sync.account.newPassword') }}</span>
          <input v-model="newPassword" type="password" autocomplete="off" />
          </label>
          </template>

          <template v-else>
          <label class="field" style="margin: 0 0 0.6rem">
          <span>{{ t('sync.account.newAccess') }}</span>
          <input v-model="newAccessToken" type="text" autocomplete="off" spellcheck="false" />
          </label>
          <label class="field" style="margin: 0 0 0.6rem">
          <span>{{ t('sync.account.newRefresh') }}</span>
          <input v-model="newRefreshToken" type="text" autocomplete="off" spellcheck="false" />
          </label>
          </template>

          <button
          class="btn btn--small save-account"
          :disabled="savingAccess"
          @click="saveAccount"
          >
          <span v-if="savingAccess" class="spinner" />
          {{ t('common.save') }}
          </button>

          <!-- ── YAZIO: история запусков и замечания ──────────────────────────── -->
          <h2 class="sub">{{ t('sync.history') }}</h2>
          <div v-if="runs.length === 0" class="card muted">{{ t('sync.history.empty') }}</div>
          <div v-else class="card">
          <div class="table-wrap">
          <table class="data">
          <thead>
          <tr>
          <th>{{ t('sync.col.started') }}</th>
          <th>{{ t('common.period') }}</th>
          <th>{{ t('sync.col.status') }}</th>
          <th class="num">{{ t('sync.col.days') }}</th>
          <th class="num">{{ t('sync.col.requests') }}</th>
          <th class="num">{{ t('sync.col.warnings') }}</th>
          </tr>
          </thead>
          <tbody>
          <tr v-for="run in runs" :key="run.id">
          <td class="mono">{{ when(run.startedAt || run.createdAt) }}</td>
          <td class="mono">{{ run.from }} — {{ run.to }}</td>
          <td>
          <span class="chip" :class="`chip--${runChip(run.status)}`">{{ run.status }}</span>
          </td>
          <td class="num mono">{{ run.daysDone }}</td>
          <td class="num mono">{{ run.requests }}</td>
          <td class="num mono">{{ run.warningsCount }}</td>
          </tr>
          </tbody>
          </table>
          </div>
          </div>

          <template v-if="lastRun && lastRun.warnings.length > 0">
          <h2 class="sub">{{ t('sync.warnings') }}</h2>
          <div class="card">
          <div class="table-wrap">
          <table class="data">
          <thead>
          <tr>
          <th>{{ t('sync.warn.stage') }}</th>
          <th>{{ t('sync.warn.what') }}</th>
          <th>{{ t('sync.warn.code') }}</th>
          <th>{{ t('sync.warn.message') }}</th>
          </tr>
          </thead>
          <tbody>
          <tr v-for="(warning, index) in lastRun.warnings.slice(0, 50)" :key="index">
          <td>{{ warning.phase }}</td>
          <td class="mono">{{ warning.key || '—' }}</td>
          <td class="mono">{{ warning.status || '—' }}</td>
          <td style="white-space: normal">{{ warning.message }}</td>
          </tr>
          </tbody>
          </table>
          </div>
          </div>
          </template>
        </div>
      </details>
    </section>

    <!-- ── Apple Health ─────────────────────────────────────────────────── -->
    <section class="card">
      <h2><AppIcon name="steps" :size="16" /> {{ t('health') }}</h2>

      <div class="sum">
        <div class="sum__facts">
          <p class="sum__when">
            {{ t('health.last') }}:
            <strong v-if="lastHealth">
              {{ when(lastHealth.finishedAt || lastHealth.createdAt) }}
            </strong>
            <strong v-else class="muted">{{ t('health.never') }}</strong>
          </p>
          <p class="sum__what tiny muted">
            <template v-if="lastHealth">
              {{
                t('health.added', {
                  days: num(lastHealth.days),
                  records: num(lastHealth.records),
                  workouts: num(lastHealth.workouts),
                })
              }}
              ·
            </template>
            {{
              drive && drive.enabled && drive.dailyAt
                ? t('health.check.on', { time: drive.dailyAt })
                : t('health.check.off')
            }}
          </p>
        </div>
        <button
          class="btn btn--primary"
          :disabled="driveBusy || !drive?.url || !!activeHealth"
          @click="checkDrive"
        >
          <span v-if="driveBusy || activeHealth" class="spinner" />
          <AppIcon v-else name="swap" :size="14" />
          {{ t('health.run') }}
        </button>
      </div>

      <div v-if="activeHealth" class="progress-wrap">
        <div class="row row--between" style="margin-bottom: 0.3rem">
          <span class="tiny">{{ activeHealth.phase || t('sync.health.progress') }}</span>
          <span class="mono tiny">{{ healthPercent }} %</span>
        </div>
        <div class="progress">
          <div class="progress__fill" :style="{ width: `${healthPercent}%` }" />
        </div>
      </div>

      <details class="more">
        <summary>{{ t('health.more') }}</summary>
        <div class="more__body">
          <p class="tiny muted" style="margin-top: 0">{{ t('health.lede') }}</p>
          <h3 class="source">{{ t('health.fromDrive') }}</h3>
          <div v-if="drive" class="card">
          <p class="tiny muted" style="margin-top: 0">{{ t('drive.lede') }}</p>

          <div v-if="!drive.keyConfigured" class="alert alert--warn">{{ t('drive.noKey') }}</div>
          <p v-else class="tiny muted" style="margin: 0 0 0.6rem">
          {{ t(`drive.access.${drive.access}`) }}
          </p>

          <label class="field" style="margin: 0 0 0.6rem">
          <span>{{ t('drive.url') }}</span>
          <input
          v-model="drive.url"
          type="url"
          :placeholder="t('drive.url.hint')"
          @change="saveDrive"
          />
          </label>

          <div class="row row--wrap" style="align-items: flex-end; gap: 0.75rem">
          <label class="field" style="margin: 0; width: 12rem">
          <span>{{ t('drive.dailyAt') }}</span>
          <input v-model="drive.dailyAt" type="text" maxlength="5" placeholder="06:30" @change="saveDrive" />
          </label>
          <label class="check" style="margin-bottom: 0.4rem">
          <input v-model="drive.enabled" type="checkbox" @change="saveDrive" />
          {{ t('drive.enabled') }}
          </label>
          <button
          class="btn btn--primary"
          type="button"
          :disabled="driveBusy || !drive.url"
          style="margin-bottom: 0.15rem"
          @click="checkDrive"
          >
          <span v-if="driveBusy" class="spinner" />
          <AppIcon v-else name="swap" :size="14" />
          {{ t('drive.check') }}
          </button>
          </div>

          <h3 style="margin: 1rem 0 0.4rem; font-size: 0.95rem">{{ t('drive.history') }}</h3>
          <p v-if="driveFetches.length === 0" class="tiny muted">{{ t('drive.history.empty') }}</p>
          <div v-else class="table-wrap">
          <table class="data">
          <thead>
          <tr>
          <th>{{ t('sync.health.loaded') }}</th>
          <th>{{ t('sync.col.status') }}</th>
          <th>{{ t('drive.col.file') }}</th>
          <th>{{ t('drive.col.trigger') }}</th>
          </tr>
          </thead>
          <tbody>
          <tr v-for="item in driveFetches" :key="item.id">
          <td class="mono">{{ when(item.finishedAt || item.startedAt) }}</td>
          <td>
          <span class="chip" :class="`chip--${DRIVE_TONE[item.status]}`">
          {{ t(`drive.status.${item.status}`) }}
          </span>
          </td>
          <td class="file-name">{{ item.fileName || '—' }}</td>
          <td class="tiny muted">{{ t(`drive.trigger.${item.trigger}`) }}</td>
          </tr>
          </tbody>
          </table>
          </div>
          <p v-if="driveFetches[0]?.error" class="alert alert--bad" style="margin: 0.75rem 0 0">
          {{ message(driveFetches[0].error) }}
          </p>
          </div>
          <h3 class="source">{{ t('health.fromDisk') }}</h3>
          <div class="card">
          <template v-if="activeHealth">
          <div class="row row--between" style="margin-bottom: 0.4rem">
          <span>{{ activeHealth.phase || t('sync.health.progress') }}</span>
          <span class="mono tiny">
          {{ healthPercent }} % · {{ t('sync.health.records') }}
          {{ activeHealth.records.toLocaleString('ru-RU') }}
          </span>
          </div>
          <div class="progress"><div class="progress__fill" :style="{ width: `${healthPercent}%` }" /></div>
          </template>

          <template v-else>
          <p v-if="healthFiles.length === 0" class="muted" style="margin-top: 0">
          {{ t('sync.health.none') }}
          </p>

          <div v-else class="row row--wrap" style="align-items: flex-end; gap: 0.75rem">
          <label class="field" style="margin: 0; flex: 1; min-width: 16rem">
          <span>{{ t('sync.health.file') }}</span>
          <select v-model="healthFile" class="file-name">
          <option v-for="file in healthFiles" :key="file.path" :value="file.path">
          {{
          t('sync.health.fileSize', {
          path: file.path,
          size: Math.round(file.sizeBytes / 1024 / 1024),
          })
          }}
          </option>
          </select>
          </label>
          <button class="btn btn--primary" :disabled="startingHealth || !healthFile" @click="startHealthImport">
          <span v-if="startingHealth" class="spinner" />
          {{ t('sync.health.start') }}
          </button>
          </div>
          <p class="tiny" style="margin: 0.4rem 0 0">
          {{ t('sync.health.replaceNote') }} {{ t('sync.health.speedNote') }}
          </p>
          </template>

          <div v-if="healthImports.length > 0" class="table-wrap" style="margin-top: 0.75rem">
          <table class="data">
          <thead>
          <tr>
          <th>{{ t('sync.health.loaded') }}</th>
          <th>{{ t('common.period') }}</th>
          <th>{{ t('sync.col.status') }}</th>
          <th class="num">{{ t('sync.health.count') }}</th>
          <th class="num">{{ t('sync.col.days') }}</th>
          <th class="num">{{ t('sync.col.trainings') }}</th>
          </tr>
          </thead>
          <tbody>
          <tr v-for="item in healthImports" :key="item.id">
          <td class="mono">{{ when(item.finishedAt || item.createdAt) }}</td>
          <td class="mono">{{ item.from || '—' }} — {{ item.to || '—' }}</td>
          <td><span class="chip" :class="`chip--${runChip(item.status)}`">{{ item.status }}</span></td>
          <td class="num mono">{{ item.records.toLocaleString('ru-RU') }}</td>
          <td class="num mono">{{ item.days }}</td>
          <td class="num mono">{{ item.workouts }}</td>
          </tr>
          </tbody>
          </table>
          </div>
          <p v-if="healthImports[0]?.error" class="alert alert--bad" style="margin: 0.75rem 0 0">
          {{ healthImports[0].error }}
          </p>
          </div>
        </div>
      </details>
    </section>

    <!-- ── удаление ─────────────────────────────────────────────────────── -->
    <section class="card">
      <h2><AppIcon name="trash" :size="16" /> {{ t('danger') }}</h2>
      <p class="tiny muted">{{ t('danger.note') }}</p>
      <button class="btn btn--danger btn--small" @click="((deleting = true), (deleteWord = ''))">
        <AppIcon name="trash" :size="13" /> {{ t('danger.open') }}
      </button>
    </section>

    <!-- Набрать слово, а не нажать «да»: удаление уносит годы выгруженного -->
    <div v-if="deleting" class="scrim" @click="deleting = false" />
    <div v-if="deleting" class="modal" role="dialog" aria-modal="true">
      <h3 style="margin-top: 0">
        {{ t('danger.title', { name: account.label || account.email }) }}
      </h3>
      <p class="tiny muted">{{ t('danger.note') }}</p>
      <label class="field">
        <span>{{ t('danger.ask', { word: t('danger.word') }) }}</span>
        <input
          v-model="deleteWord"
          type="text"
          autocomplete="off"
          :placeholder="t('danger.word')"
          @keydown.enter.prevent="deleteReady && removeAccount()"
        />
      </label>
      <div class="row" style="gap: 0.4rem">
        <button class="btn btn--danger" :disabled="!deleteReady" @click="removeAccount">
          <AppIcon name="trash" :size="14" /> {{ t('danger.confirm') }}
        </button>
        <button class="btn" @click="deleting = false">{{ t('common.cancel') }}</button>
      </div>
    </div>
  </div>

  <p v-else class="muted"><span class="spinner" /> {{ t('common.loading') }}</p>
</template>

<style scoped>
h2 {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  margin-top: 0;
}

/*
 * Сводка раздела: слева — что случилось, справа — что сделать.
 *
 * Это единственное, что видно сразу; всё остальное живёт под раскрытием
 * (D-065). Человек приходит сюда с одним вопросом — свежие ли данные, — и
 * ответ на него не должен теряться среди настроек.
 */
.sum {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
}
.sum__facts {
  min-width: 0;
}
.sum__when {
  margin: 0;
  font-size: 0.95rem;
}
.sum__what {
  margin: 0.2rem 0 0;
}

.progress-wrap {
  margin-top: 0.8rem;
}

/* раскрытие: подробности, журналы, доступ */
.more {
  margin-top: 0.9rem;
  border-top: 1px solid var(--line-soft);
  padding-top: 0.6rem;
}
.more > summary {
  cursor: pointer;
  color: var(--accent);
  font-size: 0.88rem;
  font-weight: 500;
  list-style: none;
}
.more > summary::-webkit-details-marker {
  display: none;
}
.more > summary::before {
  content: '▸ ';
  color: var(--ink-3);
}
.more[open] > summary::before {
  content: '▾ ';
}
.more__body {
  margin-top: 0.8rem;
}
.more__title,
.source,
.sub {
  margin: 1.2rem 0 0.5rem;
  font-size: 0.95rem;
  color: var(--ink-2);
}

/*
 * Окно подтверждения удаления.
 *
 * Своё, а не `confirm()`: браузерное окно спрашивает «да или нет», а на такое
 * действие «да» слишком легко нажать. Здесь надо набрать слово.
 */
.modal {
  position: fixed;
  z-index: 40;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: min(30rem, calc(100vw - 2rem));
  padding: 1.1rem 1.2rem;
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  background: var(--surface);
  box-shadow: 0 24px 60px rgb(0 0 0 / 25%);
}
</style>
