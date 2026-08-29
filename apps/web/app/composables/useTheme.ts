export type Theme = 'light' | 'dark' | 'system'
export type Palette = 'tokyo' | 'catppuccin' | 'nord' | 'graphite'

export const PALETTES: Array<{ key: Palette; title: string; note: string }> = [
  { key: 'tokyo', title: 'Токио', note: 'синий с фиолетовым, по мотивам Tokyo Night' },
  { key: 'catppuccin', title: 'Catppuccin', note: 'мягкая пастель, Latte и Mocha' },
  { key: 'nord', title: 'Nord', note: 'холодная северная гамма' },
  { key: 'graphite', title: 'Графит', note: 'почти без цвета, один акцент' },
]

const THEME_KEY = 'fatoff:theme'
const PALETTE_KEY = 'fatoff:palette'

/**
 * Тема и палитра.
 *
 * Тема — светлая, тёмная или системная; палитра — какой набор цветов при этом
 * взят. Оси независимы: у каждой палитры нарисованы обе стороны, и переключение
 * света не меняет выбранную гамму.
 *
 * Выбор хранится в localStorage и применяется атрибутами `data-theme` и
 * `data-palette`; до гидратации это делает встроенный скрипт из nuxt.config,
 * иначе страница моргает светлой у тех, кто выбрал тёмную.
 */
export function useTheme() {
  const theme = useState<Theme>('theme', () => 'system')
  const palette = useState<Palette>('palette', () => 'tokyo')

  function apply(next: Theme): void {
    theme.value = next
    if (import.meta.server) return

    const root = document.documentElement
    if (next === 'system') {
      root.removeAttribute('data-theme')
      localStorage.removeItem(THEME_KEY)
    } else {
      root.setAttribute('data-theme', next)
      localStorage.setItem(THEME_KEY, next)
    }
  }

  function choose(next: Palette): void {
    palette.value = next
    if (import.meta.server) return

    const root = document.documentElement
    // палитра по умолчанию живёт на голом :root — атрибут для неё не нужен
    if (next === 'tokyo') {
      root.removeAttribute('data-palette')
      localStorage.removeItem(PALETTE_KEY)
    } else {
      root.setAttribute('data-palette', next)
      localStorage.setItem(PALETTE_KEY, next)
    }
  }

  function restore(): void {
    if (import.meta.server) return

    const storedTheme = localStorage.getItem(THEME_KEY)
    theme.value = storedTheme === 'light' || storedTheme === 'dark' ? storedTheme : 'system'

    const storedPalette = localStorage.getItem(PALETTE_KEY)
    palette.value = PALETTES.some((item) => item.key === storedPalette)
      ? (storedPalette as Palette)
      : 'tokyo'
  }

  function cycle(): void {
    apply(theme.value === 'system' ? 'light' : theme.value === 'light' ? 'dark' : 'system')
  }

  return { theme, palette, apply, choose, restore, cycle }
}
