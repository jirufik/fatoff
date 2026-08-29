/**
 * Всё закрыто, кроме страницы входа. Сессия проверяется запросом к backend:
 * cookie httpOnly, и из JavaScript её не видно.
 */
export default defineNuxtRouteMiddleware(async (to) => {
  if (import.meta.server) return
  if (to.path === '/login') return

  const { check } = useAuth()
  if (!(await check())) return navigateTo('/login')
})
