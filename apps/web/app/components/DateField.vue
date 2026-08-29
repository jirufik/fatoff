<script setup lang="ts">
/**
 * Поле даты со своим календарём.
 *
 * `input type="date"` отдаёт всплывающий календарь браузеру, а он рисует его
 * своей плашкой: по-английски, с воскресенья, в системной гамме и без единого
 * способа это поправить — CSS туда не достаёт. Здесь календарь свой: по-русски,
 * с понедельника, в теме страницы.
 *
 * Само поле остаётся текстовым: дату можно и набрать руками в привычном виде
 * «28.08.2026», а не только выбрать мышью.
 */
const props = withDefaults(
  defineProps<{ modelValue: string; placeholder?: string; clearable?: boolean }>(),
  { placeholder: 'дд.мм.гггг', clearable: true },
)
const emit = defineEmits<{ (event: 'update:modelValue', value: string): void }>()

const MONTHS = [
  'январь', 'февраль', 'март', 'апрель', 'май', 'июнь',
  'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь',
]
const WEEKDAYS = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс']

const open = ref(false)
const typed = ref('')
const root = ref<HTMLElement | null>(null)

/** Месяц, показанный в календаре: от выбранной даты, иначе от сегодняшней. */
const view = ref(startOfMonth(props.modelValue || todayIso()))

const shown = computed(() => (open.value ? typed.value : toHuman(props.modelValue)))

const grid = computed(() => {
  const first = new Date(`${view.value}T00:00:00Z`)
  // сетка всегда начинается с понедельника той недели, в которую попало первое число
  const shift = (first.getUTCDay() + 6) % 7
  const start = new Date(first)
  start.setUTCDate(start.getUTCDate() - shift)

  return Array.from({ length: 42 }, (_, index) => {
    const day = new Date(start)
    day.setUTCDate(day.getUTCDate() + index)
    const iso = day.toISOString().slice(0, 10)
    return {
      iso,
      day: day.getUTCDate(),
      outside: iso.slice(0, 7) !== view.value.slice(0, 7),
      today: iso === todayIso(),
      selected: iso === props.modelValue,
    }
  })
})

const title = computed(() => {
  const at = new Date(`${view.value}T00:00:00Z`)
  return `${MONTHS[at.getUTCMonth()]} ${at.getUTCFullYear()}`
})

function toggle(): void {
  open.value = !open.value
  if (open.value) {
    typed.value = toHuman(props.modelValue)
    view.value = startOfMonth(props.modelValue || todayIso())
  }
}

function pick(iso: string): void {
  emit('update:modelValue', iso)
  open.value = false
}

function shiftMonth(months: number): void {
  const at = new Date(`${view.value}T00:00:00Z`)
  at.setUTCMonth(at.getUTCMonth() + months)
  view.value = at.toISOString().slice(0, 10)
}

/** Набранное руками принимается в виде «28.08.2026» и «28.8.26». */
function commitTyped(): void {
  const raw = typed.value.trim()
  if (raw === '') {
    emit('update:modelValue', '')
    return
  }

  const parts = raw.split(/[.\-/\s]+/).map(Number)
  if (parts.length !== 3 || parts.some((part) => !Number.isFinite(part))) return

  const [day, month, year] = parts
  const full = year < 100 ? 2000 + year : year
  const at = new Date(Date.UTC(full, month - 1, day))
  if (at.getUTCMonth() !== month - 1 || at.getUTCDate() !== day) return

  const iso = at.toISOString().slice(0, 10)
  emit('update:modelValue', iso)
  view.value = startOfMonth(iso)
}

function onOutside(event: MouseEvent): void {
  if (open.value && root.value && !root.value.contains(event.target as Node)) open.value = false
}
function onKey(event: KeyboardEvent): void {
  if (event.key === 'Escape') open.value = false
}

onMounted(() => {
  document.addEventListener('mousedown', onOutside)
  document.addEventListener('keydown', onKey)
})
onBeforeUnmount(() => {
  document.removeEventListener('mousedown', onOutside)
  document.removeEventListener('keydown', onKey)
})

function toHuman(iso: string): string {
  if (!iso || iso.length < 10) return ''
  return `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`
}
function startOfMonth(iso: string): string {
  return `${(iso || todayIso()).slice(0, 7)}-01`
}
function todayIso(): string {
  const at = new Date()
  return `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, '0')}-${String(at.getDate()).padStart(2, '0')}`
}
</script>

<template>
  <div ref="root" class="date">
    <div class="date__field">
      <input
        class="date__input"
        :value="shown"
        :placeholder="placeholder"
        inputmode="numeric"
        @focus="open = true; typed = toHuman(modelValue)"
        @input="typed = ($event.target as HTMLInputElement).value"
        @change="commitTyped"
        @keydown.enter.prevent="commitTyped(); open = false"
      />
      <button class="date__toggle" type="button" tabindex="-1" aria-label="Календарь" @click="toggle">
        <AppIcon name="calendar" :size="15" />
      </button>
    </div>

    <div v-if="open" class="cal">
      <div class="cal__head">
        <button type="button" class="cal__nav" aria-label="Предыдущий месяц" @click="shiftMonth(-1)">‹</button>
        <span class="cal__title">{{ title }}</span>
        <button type="button" class="cal__nav" aria-label="Следующий месяц" @click="shiftMonth(1)">›</button>
      </div>

      <div class="cal__week">
        <span v-for="weekday in WEEKDAYS" :key="weekday">{{ weekday }}</span>
      </div>

      <div class="cal__grid">
        <button
          v-for="cell in grid"
          :key="cell.iso"
          type="button"
          class="cal__day"
          :class="{
            'cal__day--out': cell.outside,
            'cal__day--today': cell.today,
            'cal__day--on': cell.selected,
          }"
          @click="pick(cell.iso)"
        >
          {{ cell.day }}
        </button>
      </div>

      <div class="cal__foot">
        <button type="button" class="btn btn--small" @click="pick(todayIso())">сегодня</button>
        <button v-if="clearable" type="button" class="btn btn--small" @click="pick('')">очистить</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.date {
  position: relative;
}
.date__field {
  position: relative;
  display: flex;
  align-items: center;
}
.date__input {
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
  padding-right: 2.2rem;
}
.date__toggle {
  position: absolute;
  right: 0.35rem;
  display: inline-grid;
  place-items: center;
  width: 1.7rem;
  height: 1.7rem;
  border: none;
  border-radius: var(--radius-xs);
  background: none;
  color: var(--ink-3);
  cursor: pointer;
}
.date__toggle:hover {
  background: var(--sunk);
  color: var(--ink);
}

.cal {
  position: absolute;
  z-index: 25;
  top: calc(100% + 0.35rem);
  left: 0;
  width: 16.5rem;
  padding: 0.6rem;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  box-shadow: var(--shadow-lift);
}
.cal__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 0.4rem;
}
.cal__title {
  font-size: 0.86rem;
  font-weight: 600;
}
.cal__nav {
  width: 1.7rem;
  height: 1.7rem;
  border: none;
  border-radius: var(--radius-xs);
  background: none;
  color: var(--ink-2);
  font-size: 1.05rem;
  line-height: 1;
  cursor: pointer;
}
.cal__nav:hover {
  background: var(--sunk);
  color: var(--ink);
}

.cal__week,
.cal__grid {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 2px;
}
.cal__week span {
  text-align: center;
  font-family: var(--font-mono);
  font-size: 0.68rem;
  color: var(--ink-3);
  padding-bottom: 0.2rem;
}
.cal__day {
  aspect-ratio: 1;
  border: none;
  border-radius: var(--radius-xs);
  background: none;
  color: var(--ink);
  font: inherit;
  font-size: 0.8rem;
  font-variant-numeric: tabular-nums;
  cursor: pointer;
}
.cal__day:hover {
  background: var(--sunk);
}
.cal__day--out {
  color: var(--ink-3);
  opacity: 0.55;
}
.cal__day--today {
  box-shadow: inset 0 0 0 1px var(--line);
}
.cal__day--on {
  background: var(--accent);
  color: color-mix(in oklab, var(--surface) 88%, var(--ink));
  font-weight: 600;
}
.cal__day--on:hover {
  background: var(--accent);
}

.cal__foot {
  display: flex;
  gap: 0.3rem;
  margin-top: 0.5rem;
  padding-top: 0.5rem;
  border-top: 1px solid var(--line-soft);
}
</style>
