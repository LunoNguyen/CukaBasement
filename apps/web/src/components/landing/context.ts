import { computed, type ComputedRef, inject, type InjectionKey, provide } from 'vue'
import { useI18n } from 'vue-i18n'
import { type LocalizedText, pickText } from '@cuka/shared'
import type { SiteImageDto } from '@/api/types'

/** What every landing section reads from LandingSections: the language to show and the resolved images. */
export interface LandingContext {
  locale: ComputedRef<string>
  images: ComputedRef<Record<string, SiteImageDto>>
  /** Rendered inside the admin editor: no data fetching side effects that would confuse an empty draft. */
  preview: boolean
}

const KEY: InjectionKey<LandingContext> = Symbol('landing')

export function provideLanding(ctx: LandingContext): void {
  provide(KEY, ctx)
}

/** The landing context, falling back to the UI language and no images (a section mounted on its own, e.g. in tests). */
export function useLanding() {
  const { locale: uiLocale } = useI18n()
  const ctx = inject(KEY, null)
  const locale = ctx?.locale ?? computed(() => uiLocale.value)
  const images = ctx?.images ?? computed<Record<string, SiteImageDto>>(() => ({}))
  /** The text in the shown language (English falls back to Vietnamese). */
  const tx = (t: LocalizedText | null | undefined) => pickText(t, locale.value)
  return { locale, images, tx, preview: ctx?.preview ?? false }
}
