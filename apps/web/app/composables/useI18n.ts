import {
  pickText,
  translate,
  translateMessage,
  type Locale,
  type Message,
  type Text,
} from '@fatoff/contracts'

export type { Locale }

export const LOCALE_LIST: Array<{ key: Locale; title: string; short: string }> = [
  { key: 'ru', title: 'Русский', short: 'RU' },
  { key: 'en', title: 'English', short: 'EN' },
]

const KEY = 'fatoff:locale'

/**
 * Язык интерфейса.
 *
 * Словари живут в общем пакете: тем же текстом сервер подписывает PDF. Сервер
 * при этом фраз не сочиняет — он присылает код и числа, а предложение
 * собирается здесь.
 */
export function useI18n() {
  const locale = useState<Locale>('locale', () => 'ru')

  function apply(next: Locale): void {
    locale.value = next
    if (import.meta.server) return
    localStorage.setItem(KEY, next)
    document.documentElement.setAttribute('lang', next)
  }

  function restore(): void {
    if (import.meta.server) return
    const stored = localStorage.getItem(KEY)
    const guess: Locale = navigator.language?.startsWith('ru') ? 'ru' : 'en'
    apply(stored === 'ru' || stored === 'en' ? stored : guess)
  }

  const t = (key: string, params?: Record<string, string | number>): string =>
    translate(locale.value, key, params)

  const message = (entry: Message): string => translateMessage(locale.value, entry)

  const pick = (value: Text | string | null | undefined): string => pickText(locale.value, value)

  return { locale, apply, restore, t, message, pick }
}
