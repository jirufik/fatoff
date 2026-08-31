/**
 * Раскрытие не должно двигать страницу под человеком.
 *
 * На странице режима и в журнале раскрыт может быть только один день. Значит,
 * клик по дню не просто добавляет подробности — он ещё и убирает подробности
 * предыдущего, а тот нередко лежит **выше**. Со страницы разом исчезает полторы
 * тысячи пикселей, и всё уезжает вверх: человек жмёт на 2 сентября, а видит
 * середину чужого дня и думает, что его перебросило в конец (D-075).
 *
 * Браузеры умеют это сглаживать сами — «scroll anchoring», — но умеют не все и
 * не всегда: Chrome удерживает, Safari на телефоне нет. Полагаться на догадку
 * браузера в том, что человек считает поломкой, нельзя.
 *
 * Поэтому положение держим сами: меряем, где строка была относительно окна,
 * даём разметке перестроиться и прокручиваем ровно на разницу. Мерить надо один
 * и тот же элемент — тогда неважно, что произошло между замерами.
 */
export async function keepInPlace(
  element: HTMLElement | null | undefined,
  change: () => void | Promise<void>,
): Promise<void> {
  if (!element) {
    await change()
    return
  }

  const before = element.getBoundingClientRect().top
  await change()
  await nextTick()

  const shift = element.getBoundingClientRect().top - before
  // дробные пиксели набегают от округления разметки, а не от переезда
  if (Math.abs(shift) > 1) window.scrollBy(0, shift)
}

/** Строка дня, внутри которой лежит нажатая кнопка. */
export function rowOf(event: Event, selector: string): HTMLElement | null {
  const target = event.currentTarget
  return target instanceof HTMLElement ? target.closest(selector) : null
}
