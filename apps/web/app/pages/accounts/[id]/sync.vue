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
  if (!confirm(t('sync.account.confirm'))) return
  try {
    await api.del(`/accounts/${id}`)
    await router.push('/')
  } catch (caught) {
    error.value = errorMessage(caught)
  }
}


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

    <!-- ── синхронизация ─────────────────────────────────────────────────── -->
    <div class="card">
      <h3>{{ t('sync.period') }}</h3>

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

      <template v-else>
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
      </template>
    </div>

    <!-- ── история запусков ──────────────────────────────────────────────── -->
    <h2>{{ t('sync.history') }}</h2>
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
      <h2>{{ t('sync.warnings') }}</h2>
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

    <h2>{{ t('sync.health') }}</h2>
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

    <!-- ── выгрузка из Google Drive ────────────────────────────────────── -->
    <h2>{{ t('drive') }}</h2>
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

    <h2>{{ t('sync.account') }}</h2>
    <div class="card">
      <label class="field" style="margin: 0 0 0.6rem">
        <span>{{ t('sync.account.label') }}</span>
        <input v-model="newLabel" type="text" maxlength="64" :placeholder="account.email" />
      </label>

      <div class="row row--wrap" style="align-items: flex-end; gap: 0.75rem; margin-bottom: 0.4rem">
        <label class="field" style="margin: 0; width: 12rem">
          <span>{{ t('sync.daily') }}</span>
          <input v-model="syncDailyAt" type="text" maxlength="5" placeholder="06:30" />
        </label>
        <label class="check" style="margin-bottom: 0.4rem">
          <input v-model="account.syncEnabled" type="checkbox" />
          {{ t('sync.account.auto') }}
        </label>
      </div>
      <p class="tiny muted" style="margin: 0 0 0.8rem">{{ t('sync.daily.note') }}</p>

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
    </div>

    <h2>{{ t('sync.danger') }}</h2>
    <div class="card row row--between">
      <span class="muted">{{ t('sync.danger.note') }}</span>
      <button class="btn btn--danger btn--small" @click="removeAccount">{{ t('sync.account.delete') }}</button>
    </div>
  </div>

  <p v-else class="muted"><span class="spinner" /> {{ t('common.loading') }}</p>
</template>
