import { createRouter, createWebHistory, type RouterHistory } from 'vue-router'
import type { Role } from '@cuka/shared'
import HomePage from '@/pages/HomePage.vue'
import RankingPage from '@/pages/RankingPage.vue'
import IntroPage from '@/pages/IntroPage.vue'
import TagPage from '@/pages/TagPage.vue'
import SearchPage from '@/pages/SearchPage.vue'
import PostPage from '@/pages/PostPage.vue'
import ForbiddenPage from '@/pages/ForbiddenPage.vue'
import ProfilePage from '@/pages/ProfilePage.vue'
import NotFoundPage from '@/pages/NotFoundPage.vue'
import { useAuth } from '@/stores/auth'

declare module 'vue-router' {
  interface RouteMeta {
    auth?: boolean
    roles?: Role[]
    /** The page draws its own full-width bands (no centred column, no top padding). */
    fullBleed?: boolean
  }
}

// Pages most visitors never open (and the heavy upload/edit forms) load as separate chunks.
const UploadPage = () => import('@/pages/UploadPage.vue')
const EditPostPage = () => import('@/pages/EditPostPage.vue')
const SettingsPage = () => import('@/pages/SettingsPage.vue')
const NotificationsPage = () => import('@/pages/NotificationsPage.vue')
const ModPage = () => import('@/pages/mod/ModPage.vue')
const AdminPage = () => import('@/pages/admin/AdminPage.vue')
const LoginPage = () => import('@/pages/auth/LoginPage.vue')
const RegisterPage = () => import('@/pages/auth/RegisterPage.vue')
const VerifyEmailPage = () => import('@/pages/auth/VerifyEmailPage.vue')
const ForgotPasswordPage = () => import('@/pages/auth/ForgotPasswordPage.vue')
const ResetPasswordPage = () => import('@/pages/auth/ResetPasswordPage.vue')

export function createAppRouter(history: RouterHistory = createWebHistory()) {
  const router = createRouter({
    history,
    routes: [
      // The fanart gallery: banner, tags, type filter, ranking and the latest / following feed.
      { path: '/', name: 'home', component: HomePage },
      { path: '/ranking', name: 'ranking', component: RankingPage },
      { path: '/gioi-thieu', name: 'intro', component: IntroPage, meta: { fullBleed: true } },
      { path: '/intro', redirect: '/gioi-thieu' },
      // The old feed addresses: the feed is part of "/" now (the type filter carries over).
      { path: '/posts', redirect: (to) => ({ path: '/', query: to.query }) },
      { path: '/feed', redirect: (to) => ({ path: '/', query: to.query }) },
      { path: '/403', name: 'forbidden', component: ForbiddenPage },
      { path: '/login', component: LoginPage },
      { path: '/register', component: RegisterPage },
      { path: '/forgot-password', component: ForgotPasswordPage },
      { path: '/reset-password', component: ResetPasswordPage },
      { path: '/verify-email', component: VerifyEmailPage },
      { path: '/upload', component: UploadPage, meta: { auth: true } },
      { path: '/posts/:id', component: PostPage },
      { path: '/posts/:id/edit', component: EditPostPage, meta: { auth: true } },
      { path: '/u/:username', component: ProfilePage },
      { path: '/settings', component: SettingsPage, meta: { auth: true } },
      { path: '/notifications', component: NotificationsPage, meta: { auth: true } },
      { path: '/mod', component: ModPage, meta: { auth: true, roles: ['moderator', 'admin'] } },
      { path: '/admin', component: AdminPage, meta: { auth: true, roles: ['admin'] } },
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
