import { createRouter, createWebHistory, type RouterHistory } from 'vue-router'
import type { Role } from '@cuka/shared'
import HomePage from '@/pages/HomePage.vue'
import TagPage from '@/pages/TagPage.vue'
import SearchPage from '@/pages/SearchPage.vue'
import PostPage from '@/pages/PostPage.vue'
import UploadPage from '@/pages/UploadPage.vue'
import EditPostPage from '@/pages/EditPostPage.vue'
import ForbiddenPage from '@/pages/ForbiddenPage.vue'
import NotFoundPage from '@/pages/NotFoundPage.vue'
import LoginPage from '@/pages/auth/LoginPage.vue'
import RegisterPage from '@/pages/auth/RegisterPage.vue'
import VerifyEmailPage from '@/pages/auth/VerifyEmailPage.vue'
import ForgotPasswordPage from '@/pages/auth/ForgotPasswordPage.vue'
import ResetPasswordPage from '@/pages/auth/ResetPasswordPage.vue'
import { useAuth } from '@/stores/auth'

declare module 'vue-router' {
  interface RouteMeta {
    auth?: boolean
    roles?: Role[]
  }
}

const Stub = () => import('@/pages/StubPage.vue')

export function createAppRouter(history: RouterHistory = createWebHistory()) {
  const router = createRouter({
    history,
    routes: [
      { path: '/', name: 'home', component: HomePage },
      { path: '/403', name: 'forbidden', component: ForbiddenPage },
      // Stubs: later tasks replace these components.
      { path: '/login', component: LoginPage },
      { path: '/register', component: RegisterPage },
      { path: '/forgot-password', component: ForgotPasswordPage },
      { path: '/reset-password', component: ResetPasswordPage },
      { path: '/verify-email', component: VerifyEmailPage },
      { path: '/upload', component: UploadPage, meta: { auth: true } },
      { path: '/posts/:id', component: PostPage },
      { path: '/posts/:id/edit', component: EditPostPage, meta: { auth: true } },
      { path: '/u/:username', component: Stub },
      { path: '/settings', component: Stub, meta: { auth: true } },
      { path: '/notifications', component: Stub, meta: { auth: true } },
      { path: '/mod', component: Stub, meta: { auth: true, roles: ['moderator', 'admin'] } },
      { path: '/admin', component: Stub, meta: { auth: true, roles: ['admin'] } },
      { path: '/tags/:tag', component: TagPage },
      { path: '/search', component: SearchPage },
      { path: '/:pathMatch(.*)*', name: 'not-found', component: NotFoundPage },
    ],
  })

  // Only guarded routes need to know who is logged in, so only they wait for the start-up refresh.
  router.beforeEach(async (to) => {
    if (!to.meta.auth && !to.meta.roles) return true
    const auth = useAuth()
    await auth.whenReady()
    if (!auth.isLoggedIn) return { path: '/login', query: { next: to.fullPath } }
    if (to.meta.roles && !to.meta.roles.includes(auth.user!.role)) return '/403'
    return true
  })

  return router
}

export const router = createAppRouter()
