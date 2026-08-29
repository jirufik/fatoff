/**
 * Единая точка обращения к backend. Cookie-сессия едет автоматически,
 * а 401 всюду означает одно и то же — сессия кончилась, надо на логин.
 *
 * Исключение — проверка сессии, она зовётся с `redirectOn401: false`.
 * Для неё 401 это обычный ответ «не залогинен», а не сбой. Если уводить
 * на логин и отсюда, навигация стартует изнутри route middleware, следом
 * middleware начинает свою — вторая обрывает первую, и Nuxt показывает 500.
 */
export type ApiOptions = { redirectOn401?: boolean }

export function useApi() {
  const router = useRouter()

  async function request<T>(
    path: string,
    options: Parameters<typeof $fetch>[1] = {},
    { redirectOn401 = true }: ApiOptions = {},
  ): Promise<T> {
    try {
      return await $fetch<T>(`/api${path}`, { credentials: 'include', ...options })
    } catch (error) {
      const status =
        (error as { statusCode?: number }).statusCode ?? (error as { status?: number }).status
      if (redirectOn401 && status === 401 && router.currentRoute.value.path !== '/login') {
        await router.push('/login')
      }
      throw error
    }
  }

  return {
    get: <T>(path: string, opts?: ApiOptions) => request<T>(path, {}, opts),
    post: <T>(path: string, body?: unknown, opts?: ApiOptions) =>
      request<T>(path, { method: 'POST', body }, opts),
    patch: <T>(path: string, body?: unknown, opts?: ApiOptions) =>
      request<T>(path, { method: 'PATCH', body }, opts),
    del: <T>(path: string, opts?: ApiOptions) => request<T>(path, { method: 'DELETE' }, opts),
  }
}

/** Человекочитаемое сообщение из ответа NestJS. */
export function errorMessage(error: unknown): string {
  const data = (error as { data?: { message?: string | string[] } }).data
  const message = data?.message
  if (Array.isArray(message)) return message.join('; ')
  if (typeof message === 'string') return message
  return error instanceof Error ? error.message : 'Неизвестная ошибка'
}
