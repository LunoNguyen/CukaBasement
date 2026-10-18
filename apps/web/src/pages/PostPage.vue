<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import * as postsApi from '@/api/endpoints/posts'
import * as interactionsApi from '@/api/endpoints/interactions'
import * as modApi from '@/api/endpoints/mod'
import { getUser } from '@/api/endpoints/users'
import { ApiError } from '@/api/client'
import type { PostCardDto, PostDto, PublicUserDto } from '@/api/types'
import { useAuth } from '@/stores/auth'
import { useToast } from '@/stores/toast'
import Btn from '@/components/common/Btn.vue'
import EmptyState from '@/components/common/EmptyState.vue'
import Modal from '@/components/common/Modal.vue'
import Spinner from '@/components/common/Spinner.vue'
import CommentList from '@/components/post/CommentList.vue'
import CreditLine from '@/components/post/CreditLine.vue'
import MediaViewer from '@/components/post/MediaViewer.vue'
import PostGrid from '@/components/post/PostGrid.vue'
import ReportDialog from '@/components/post/ReportDialog.vue'
import UserCard from '@/components/user/UserCard.vue'

const POLL_MS = 5000
const MAX_POLLS = 12
const MORE_COUNT = 6

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const auth = useAuth()
const toast = useToast()

const post = ref<PostDto | null>(null)
const error = ref<ApiError | null>(null)
const loading = ref(false)
const author = ref<PublicUserDto | null>(null)
const more = ref<PostCardDto[]>([])

const isOwner = computed(() => !!post.value && auth.user?.id === post.value.author.id)
const reviewBadge = computed((): string | null => {
  const p = post.value
  if (!p || !(isOwner.value || auth.isStaff)) return null
  if (p.review.status === 'pending') return t('post.pending')
  if (p.review.status === 'rejected') return t('post.rejected', { reason: p.review.reason ?? '' })
  return null
})
const hiddenBadge = computed(() => {
  const p = post.value
  return !!p && (isOwner.value || auth.isStaff) && p.visibility !== 'public'
})
const loginNext = computed(() => ({ path: '/login', query: { next: route.fullPath } }))

function errorText(e: unknown): string {
  return t('errors.' + (e instanceof ApiError ? e.code : 'INTERNAL'))
}

// ---- loading and polling for media still being processed (Review Focus 5) ----

/** Incremented on every load and on unmount: responses and timers of an older generation are ignored. */
let gen = 0
let timer: ReturnType<typeof setTimeout> | null = null
let polls = 0

function stopPolling() {
  if (timer !== null) clearTimeout(timer)
  timer = null
}

/** Images and videos get thumbnails once processed; audio and downloads never have any. */
function hasPendingMedia(p: PostDto): boolean {
  return p.media.some((m) => (m.kind === 'image' || m.kind === 'video') && m.status !== 'failed' && m.thumbMdUrl === null)
}

function schedulePoll(g: number) {
  if (g !== gen || polls >= MAX_POLLS || !post.value || !hasPendingMedia(post.value)) return
  timer = setTimeout(async () => {
    timer = null
    polls++
    try {
      const p = await postsApi.getPost(post.value!.id)
      if (g !== gen) return
      post.value = p
    } catch {
      /* try again on the next tick */
    }
    schedulePoll(g)
  }, POLL_MS)
}

async function loadAuthor(g: number, p: PostDto) {
  const [user, posts] = await Promise.allSettled([getUser(p.author.username), postsApi.userPosts(p.author.username, null, MORE_COUNT + 1)])
  if (g !== gen) return
  if (user.status === 'fulfilled') author.value = user.value
  if (posts.status === 'fulfilled') more.value = posts.value.items.filter((c) => c.id !== p.id).slice(0, MORE_COUNT)
}

async function load(id: string) {
  const g = ++gen
  stopPolling()
  polls = 0
  post.value = null
  author.value = null
  more.value = []
  error.value = null
  loading.value = true
  try {
    const p = await postsApi.getPost(id)
    if (g !== gen) return
    post.value = p
    schedulePoll(g)
    void loadAuthor(g, p)
  } catch (e) {
    if (g === gen) error.value = e instanceof ApiError ? e : new ApiError('INTERNAL', 0)
  } finally {
    if (g === gen) loading.value = false
  }
}

watch(
  () => route.params.id,
  (id) => {
    if (typeof id === 'string') void load(id)
  },
  { immediate: true },
)

// Logging in or out while here changes what the API returns (owner/staff fields, viewerState).
// Changes during the start-up refresh are ignored: requests already wait for it.
watch(
  () => auth.user?.id,
  () => {
    const id = route.params.id
    if (auth.ready && typeof id === 'string') void load(id)
  },
)

onBeforeUnmount(() => {
  gen++
  stopPolling()
})

// ---- like / bookmark (optimistic) ----

function requireLogin(): boolean {
  if (auth.isLoggedIn) return true
  void router.push(loginNext.value)
  return false
}

/** Applies `fn` to the current post only if it is still the one with `id`. */
function patch(id: string, fn: (p: PostDto) => void) {
  if (post.value?.id === id) fn(post.value)
}

const likeBusy = ref(false)
async function toggleLike() {
  const p = post.value
  if (!p || !requireLogin() || likeBusy.value) return
  const id = p.id
  const was = p.viewerState.liked
  const before = p.counts.likes
  patch(id, (x) => {
    x.viewerState.liked = !was
    x.counts.likes = before + (was ? -1 : 1)
  })
  likeBusy.value = true
  try {
    const r = await (was ? interactionsApi.unlike(id) : interactionsApi.like(id))
    patch(id, (x) => {
      x.viewerState.liked = r.liked
      x.counts.likes = r.likes
    })
  } catch (e) {
    patch(id, (x) => {
      x.viewerState.liked = was
      x.counts.likes = before
    })
    toast.push({ kind: 'error', text: errorText(e) })
  } finally {
    likeBusy.value = false
  }
}

const bookmarkBusy = ref(false)
const bookmarkMenu = ref(false)
const bookmarkWrap = ref<HTMLElement | null>(null)

function onMenuKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') bookmarkMenu.value = false
}
function onMenuOutside(e: MouseEvent) {
  if (!bookmarkWrap.value?.contains(e.target as Node)) bookmarkMenu.value = false
}
function unlistenMenu() {
  document.removeEventListener('keydown', onMenuKeydown)
  document.removeEventListener('click', onMenuOutside)
}
// Listeners are added after the opening click has finished dispatching (watchers run later), so it does not close the menu.
watch(bookmarkMenu, (open) => {
  unlistenMenu()
  if (!open) return
  document.addEventListener('keydown', onMenuKeydown)
  document.addEventListener('click', onMenuOutside)
})
onBeforeUnmount(unlistenMenu)
async function toggleBookmark(isPrivate = false) {
  bookmarkMenu.value = false
  const p = post.value
  if (!p || !requireLogin() || bookmarkBusy.value) return
  const id = p.id
  const was = p.viewerState.bookmarked
  const before = p.counts.bookmarks
  patch(id, (x) => {
    x.viewerState.bookmarked = !was
    x.counts.bookmarks = before + (was ? -1 : 1)
  })
  bookmarkBusy.value = true
  try {
    const r = await (was ? interactionsApi.unbookmark(id) : interactionsApi.bookmark(id, isPrivate))
    patch(id, (x) => {
      x.viewerState.bookmarked = r.bookmarked
      x.counts.bookmarks = r.bookmarks
    })
  } catch (e) {
    patch(id, (x) => {
      x.viewerState.bookmarked = was
      x.counts.bookmarks = before
    })
    toast.push({ kind: 'error', text: errorText(e) })
  } finally {
    bookmarkBusy.value = false
  }
}

// ---- share ----

async function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text)
  const ta = document.createElement('textarea')
  ta.value = text
  ta.setAttribute('readonly', '')
  ta.style.position = 'fixed'
  ta.style.opacity = '0'
  document.body.appendChild(ta)
  ta.select()
  const ok = document.execCommand('copy')
  ta.remove()
  if (!ok) throw new Error('copy failed')
}

async function share() {
  if (!post.value) return
  try {
    await copyText(`${location.origin}/og/posts/${post.value.id}`)
    toast.push({ kind: 'success', text: t('post.copied') })
  } catch {
    toast.push({ kind: 'error', text: t('errors.INTERNAL') })
  }
}

// ---- staff: hide / restore (visibility) ----

const modBusy = ref(false)
async function moderate(action: 'hide' | 'restore') {
  const p = post.value
  if (!p || modBusy.value) return
  const id = p.id
  modBusy.value = true
  try {
    const r = await (action === 'hide' ? modApi.hide(id) : modApi.restore(id))
    patch(id, (x) => (x.visibility = r.visibility))
  } catch (e) {
    // CANNOT_MODERATE_PEER (another moderator's/admin's post) has its own message under errors.*.
    toast.push({ kind: 'error', text: errorText(e) })
  } finally {
    modBusy.value = false
  }
}

// ---- report / delete ----

const reportOpen = ref(false)
const loginPrompt = ref(false)
function openReport() {
  if (auth.isLoggedIn) reportOpen.value = true
  else loginPrompt.value = true
}

const deleteOpen = ref(false)
const deleting = ref(false)
async function confirmDelete() {
  if (!post.value || deleting.value) return
  deleting.value = true
  try {
    await postsApi.deletePost(post.value.id)
    deleteOpen.value = false
    toast.push({ kind: 'success', text: t('post.deleted') })
    void router.push('/')
  } catch (e) {
    toast.push({ kind: 'error', text: errorText(e) })
  } finally {
    deleting.value = false
  }
}
</script>

<template>
  <div v-if="loading" class="flex justify-center py-10"><Spinner /></div>
  <EmptyState v-else-if="error">{{ t('errors.' + error.code) }}</EmptyState>
  <article v-else-if="post" class="flex flex-col gap-6">
    <div class="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
      <MediaViewer :post="post" />

      <div class="flex min-w-0 flex-col gap-4">
        <div class="flex flex-col gap-1">
          <p v-if="reviewBadge" data-test="review-badge" class="self-start rounded bg-[var(--c-accent)] px-2 py-0.5 text-xs font-semibold text-white">
            {{ reviewBadge }}
          </p>
          <p v-if="hiddenBadge" data-test="visibility-badge" class="self-start rounded bg-[var(--c-muted)] px-2 py-0.5 text-xs font-semibold text-white">
            {{ t('post.hiddenBadge') }}
          </p>
          <h1 class="text-xl font-bold break-words">{{ post.title }}</h1>
          <div data-test="credit" class="flex flex-col gap-0.5 text-sm text-[var(--c-muted)]">
            <CreditLine :credit="post.credit" :author="post.author" />
            <p v-if="post.credit.permissionNote">{{ t('post.permissionNote', { note: post.credit.permissionNote }) }}</p>
            <a
              v-if="!post.credit.isOwnWork && post.credit.sourceUrl"
              data-test="source-link"
              :href="post.credit.sourceUrl"
              target="_blank"
              rel="noopener noreferrer nofollow"
              class="self-start underline"
              >{{ t('post.viewSource') }}</a
            >
          </div>
        </div>

        <div class="flex flex-wrap items-center gap-2">
          <Btn data-test="like" variant="ghost" :aria-pressed="post.viewerState.liked" :aria-label="`${t('post.like')} (${post.counts.likes})`" @click="toggleLike">
            <span :class="{ 'text-[var(--c-accent)]': post.viewerState.liked }">♥</span> {{ post.counts.likes }}
          </Btn>
          <div ref="bookmarkWrap" class="relative flex">
            <Btn data-test="bookmark" variant="ghost" :aria-pressed="post.viewerState.bookmarked" :aria-label="`${t('post.bookmark')} (${post.counts.bookmarks})`" @click="toggleBookmark()">
              <span :class="{ 'text-[var(--c-accent)]': post.viewerState.bookmarked }">★</span> {{ post.counts.bookmarks }}
            </Btn>
            <button
              v-if="!post.viewerState.bookmarked"
              type="button"
              data-test="bookmark-menu"
              class="px-1 text-sm"
              :aria-label="t('post.bookmarkMenu')"
              aria-haspopup="menu"
              :aria-expanded="bookmarkMenu"
              @click="bookmarkMenu = !bookmarkMenu"
            >
              ▾
            </button>
            <div v-if="bookmarkMenu" role="menu" class="absolute top-full left-0 z-10 mt-1 rounded border border-[var(--c-border)] bg-[var(--c-surface)] shadow">
              <button type="button" role="menuitem" data-test="bookmark-private" class="px-3 py-2 text-sm whitespace-nowrap" @click="toggleBookmark(true)">
                {{ t('post.bookmarkPrivate') }}
              </button>
            </div>
          </div>
          <Btn data-test="share" variant="ghost" @click="share">{{ t('post.share') }}</Btn>
          <Btn v-if="!isOwner" data-test="report" variant="ghost" @click="openReport">{{ t('post.report') }}</Btn>
          <template v-if="isOwner">
            <RouterLink data-test="edit-post" :to="`/posts/${post.id}/edit`" class="rounded border border-[var(--c-border)] px-3 py-1.5 text-sm font-semibold">{{
              t('post.edit')
            }}</RouterLink>
            <Btn data-test="delete-post" variant="danger" @click="deleteOpen = true">{{ t('post.delete') }}</Btn>
          </template>
          <template v-if="auth.isStaff">
            <Btn v-if="post.visibility === 'public'" data-test="mod-hide" variant="ghost" :loading="modBusy" @click="moderate('hide')">{{ t('mod.hide') }}</Btn>
            <Btn v-else data-test="mod-restore" variant="ghost" :loading="modBusy" @click="moderate('restore')">{{ t('mod.restore') }}</Btn>
          </template>
        </div>

        <p v-if="post.description" class="text-sm break-words whitespace-pre-line">{{ post.description }}</p>
        <div v-if="post.tags.length" class="flex flex-wrap gap-2">
          <RouterLink v-for="tag in post.tags" :key="tag" :to="`/tags/${encodeURIComponent(tag)}`" class="text-sm text-[var(--c-accent)]">#{{ tag }}</RouterLink>
        </div>

        <UserCard v-if="author" :user="author" @change="author = $event" />

        <CommentList :key="post.id" :post-id="post.id" />
      </div>
    </div>

    <section v-if="more.length" data-test="more-by-author" class="flex flex-col gap-3">
      <h2 class="text-lg font-semibold">{{ t('post.moreByAuthor') }}</h2>
      <PostGrid :items="more" />
    </section>

    <ReportDialog v-model:open="reportOpen" :post-id="post.id" />
    <Modal v-model:open="loginPrompt" :title="t('post.reportTitle')">
      <div data-test="login-prompt" class="flex flex-col gap-3 text-sm">
        <p>{{ t('post.reportLogin') }}</p>
        <RouterLink :to="loginNext" class="self-start rounded bg-[var(--c-primary)] px-3 py-1.5 font-semibold text-[var(--c-bg)]">{{ t('auth.login') }}</RouterLink>
      </div>
    </Modal>
    <Modal v-model:open="deleteOpen" :title="t('post.deleteTitle')">
      <p class="mb-4 text-sm">{{ t('post.deleteConfirm') }}</p>
      <div class="flex justify-end gap-2">
        <Btn variant="ghost" @click="deleteOpen = false">{{ t('common.cancel') }}</Btn>
        <Btn data-test="confirm-delete" variant="danger" :loading="deleting" @click="confirmDelete">{{ t('post.delete') }}</Btn>
      </div>
    </Modal>
  </article>
</template>
