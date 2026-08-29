export function useAuth() {
  const api = useApi()
  const router = useRouter()

  async function login(password: string): Promise<void> {
    await api.post('/auth/login', { password })
    await router.push('/')
  }

  async function logout(): Promise<void> {
    try {
      await api.post('/auth/logout')
    } finally {
      await router.push('/login')
    }
  }

  /** Жива ли сессия. 401 здесь — обычный ответ, а не сбой. */
  async function check(): Promise<boolean> {
    try {
      await api.get('/auth/session', { redirectOn401: false })
      return true
    } catch {
      return false
    }
  }

  return { login, logout, check }
}
