import { createRouter, createWebHistory, type RouterHistory } from 'vue-router'
import type { Role } from '@cuka/shared'
import HomePage from '@/pages/HomePage.vue'
import ForbiddenPage from '@/pages/ForbiddenPage.vue'
import NotFoundPage from '@/pages/NotFoundPage.vue'

declare module 'vue-router' {
  interface RouteMeta {
    auth?: boolean
    roles?: Role[]
  }
}

const Stub = () => import('@/pages/StubPage.vue')

export function createAppRouter(history: RouterHistory = createWebHistory()) {
  return createRouter({
    history,
    routes: [
      { path: '/', name: 'home', component: HomePage },
      { path: '/403', name: 'forbidden', component: ForbiddenPage },
      // Stubs: later tasks replace these components.
      { path: '/login', component: Stub },
      { path: '/register', component: Stub },
      { path: '/forgot-password', component: Stub },
      { path: '/reset-password', component: Stub },
      { path: '/verify-email', component: Stub },
      { path: '/upload', component: Stub, meta: { auth: true } },
      { path: '/posts/:id', component: Stub },
      { path: '/u/:username', component: Stub },
      { path: '/settings', component: Stub, meta: { auth: true } },
      { path: '/notifications', component: Stub, meta: { auth: true } },
      { path: '/mod', component: Stub, meta: { auth: true, roles: ['moderator', 'admin'] } },
      { path: '/admin', component: Stub, meta: { auth: true, roles: ['admin'] } },
      { path: '/tags/:tag', component: Stub },
      { path: '/search', component: Stub },
      { path: '/:pathMatch(.*)*', name: 'not-found', component: NotFoundPage },
    ],
  })
}

export const router = createAppRouter()
