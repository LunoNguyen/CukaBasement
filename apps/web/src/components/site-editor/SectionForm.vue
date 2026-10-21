<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { GALLERY_LAYOUTS, HOME_LIMITS as L, type HomeSection, parseYouTubeId, SOCIAL_PLATFORM_LABELS, SOCIAL_PLATFORMS } from '@cuka/shared'
import ItemList from './ItemList.vue'
import LocalizedInput from './LocalizedInput.vue'
import SiteImageField from './SiteImageField.vue'
import { lt, newImage } from './model'

/** The fields of one section; edits go straight into the section object (the editor compares against the saved copy). */
const props = defineProps<{ section: HomeSection }>()
const { t } = useI18n()
const s = computed(() => props.section)
const isUrl = (v: string) => /^https?:\/\/\S+$/i.test(v.trim())
const isHref = (v: string) => v.trim() === '' || /^\/(?!\/)\S*$/.test(v.trim()) || isUrl(v)
</script>

<template>
  <div class="flex flex-col gap-5" data-test="section-form">
    <!-- Shared heading fields -->
    <template v-if="s.type !== 'hero' && s.type !== 'banner'">
      <LocalizedInput v-model="s.data.eyebrow" :label="t('admin.home.f.eyebrow')" :max="L.eyebrowMax" />
      <LocalizedInput v-model="s.data.heading" :label="t('admin.home.f.heading')" :max="L.headingMax" required test-id="f-heading" />
    </template>

    <template v-if="s.type === 'hero'">
      <LocalizedInput v-model="s.data.eyebrow" :label="t('admin.home.f.eyebrow')" :max="L.eyebrowMax" />
      <LocalizedInput v-model="s.data.title" :label="t('admin.home.f.title')" :max="L.headingMax" required test-id="f-title" />
      <LocalizedInput v-model="s.data.subtitle" :label="t('admin.home.f.subtitle')" :max="L.subtitleMax" multiline />
      <ItemList v-model="s.data.images" :label="t('admin.home.f.slides')" :max="L.heroImagesMax" :add-label="t('admin.home.addSlide')" :create="() => newImage('')" test-id="hero-images">
        <template #default="{ item, index, update }">
          <SiteImageField :model-value="item" :label="t('admin.home.f.slide', { n: index + 1 })" :optional="false" @update:model-value="(v) => v && update(v)" />
          <p v-if="!item.fileId" class="text-xs text-[var(--c-danger)]">{{ t('admin.home.pickRequired') }}</p>
        </template>
      </ItemList>
      <ItemList v-model="s.data.ctas" :label="t('admin.home.f.ctas')" :max="L.ctasMax" :add-label="t('admin.home.addCta')" :create="() => ({ label: lt(), href: '/posts' })">
        <template #default="{ item }">
          <LocalizedInput v-model="item.label" :label="t('admin.home.f.ctaLabel')" :max="L.labelMax" required />
          <label class="flex flex-col gap-1.5 text-sm font-medium">
            {{ t('admin.home.f.href') }}
            <input v-model="item.href" class="field font-mono" type="text" :maxlength="L.urlMax" placeholder="/posts" :aria-invalid="!isHref(item.href) || undefined" />
            <span class="text-xs font-normal text-[var(--c-muted)]">{{ t('admin.home.hrefHint') }}</span>
          </label>
        </template>
      </ItemList>
    </template>

    <template v-else-if="s.type === 'about'">
      <LocalizedInput v-model="s.data.body" :label="t('admin.home.f.body')" :max="L.bodyMax" multiline :rows="9" :hint="t('admin.home.markdownHint')" test-id="f-body" />
      <SiteImageField v-model="s.data.image" :label="t('admin.home.f.image')" />
      <label class="flex flex-col gap-1.5 text-sm font-medium">
        {{ t('admin.home.f.imageSide') }}
        <select v-model="s.data.imageSide" class="field">
          <option value="right">{{ t('admin.home.side.right') }}</option>
          <option value="left">{{ t('admin.home.side.left') }}</option>
        </select>
      </label>
    </template>

    <template v-else-if="s.type === 'profile'">
      <SiteImageField v-model="s.data.image" :label="t('admin.home.f.portrait')" />
      <ItemList v-model="s.data.facts" :label="t('admin.home.f.facts')" :max="L.factsMax" :add-label="t('admin.home.addFact')" :create="() => ({ label: lt(), value: lt() })" test-id="facts">
        <template #default="{ item }">
          <LocalizedInput v-model="item.label" :label="t('admin.home.f.factLabel')" :max="L.labelMax" required />
          <LocalizedInput v-model="item.value" :label="t('admin.home.f.factValue')" :max="L.factValueMax" required />
        </template>
      </ItemList>
    </template>

    <template v-else-if="s.type === 'timeline'">
      <ItemList v-model="s.data.items" :label="t('admin.home.f.milestones')" :max="L.timelineMax" :add-label="t('admin.home.addMilestone')" :create="() => ({ date: '', title: lt(), text: lt(), image: null })" test-id="milestones">
        <template #default="{ item }">
          <label class="flex flex-col gap-1.5 text-sm font-medium">
            {{ t('admin.home.f.date') }}<input v-model="item.date" class="field font-mono" type="text" :maxlength="L.dateMax" placeholder="08/08/2021" />
          </label>
          <LocalizedInput v-model="item.title" :label="t('admin.home.f.title')" :max="L.headingMax" required />
          <LocalizedInput v-model="item.text" :label="t('admin.home.f.text')" :max="L.shortTextMax" multiline :rows="2" />
          <SiteImageField v-model="item.image" :label="t('admin.home.f.image')" />
        </template>
      </ItemList>
    </template>

    <template v-else-if="s.type === 'gallery'">
      <label class="flex flex-col gap-1.5 text-sm font-medium">
        {{ t('admin.home.f.layout') }}
        <select v-model="s.data.layout" class="field" data-test="f-layout">
          <option v-for="l in GALLERY_LAYOUTS" :key="l" :value="l">{{ t(`admin.home.layout.${l}`) }}</option>
        </select>
      </label>
      <ItemList v-model="s.data.items" :label="t('admin.home.f.images')" :max="L.galleryMax" :add-label="t('admin.home.addImage')" :create="() => ({ image: newImage(''), caption: lt(), href: '' })" test-id="gallery-items">
        <template #default="{ item }">
          <SiteImageField v-model="item.image" :label="t('admin.home.f.image')" :optional="false" />
          <p v-if="!item.image.fileId" class="text-xs text-[var(--c-danger)]">{{ t('admin.home.pickRequired') }}</p>
          <LocalizedInput v-model="item.caption" :label="t('admin.home.f.caption')" :max="L.subtitleMax" />
          <label class="flex flex-col gap-1.5 text-sm font-medium">
            {{ t('admin.home.f.hrefOptional') }}<input v-model="item.href" class="field font-mono" type="text" :maxlength="L.urlMax" :aria-invalid="!isHref(item.href) || undefined" />
          </label>
        </template>
      </ItemList>
    </template>

    <template v-else-if="s.type === 'videos'">
      <ItemList v-model="s.data.items" :label="t('admin.home.f.videos')" :max="L.videosMax" :add-label="t('admin.home.addVideo')" :create="() => ({ url: '', title: lt() })" test-id="videos">
        <template #default="{ item }">
          <label class="flex flex-col gap-1.5 text-sm font-medium">
            {{ t('admin.home.f.youtube') }}
            <input v-model="item.url" class="field font-mono" type="url" :maxlength="L.urlMax" placeholder="https://www.youtube.com/watch?v=…" :aria-invalid="(item.url && !parseYouTubeId(item.url)) || undefined" />
            <span v-if="item.url && !parseYouTubeId(item.url)" class="text-xs font-normal text-[var(--c-danger)]">{{ t('admin.home.notYoutube') }}</span>
          </label>
          <LocalizedInput v-model="item.title" :label="t('admin.home.f.titleOptional')" :max="L.headingMax" />
        </template>
      </ItemList>
    </template>

    <template v-else-if="s.type === 'links'">
      <ItemList v-model="s.data.items" :label="t('admin.home.f.links')" :max="L.linksMax" :add-label="t('admin.home.addLink')" :create="() => ({ platform: 'youtube' as const, label: lt(), url: '' })" test-id="links">
        <template #default="{ item }">
          <label class="flex flex-col gap-1.5 text-sm font-medium">
            {{ t('admin.home.f.platform') }}
            <select v-model="item.platform" class="field">
              <option v-for="p in SOCIAL_PLATFORMS" :key="p" :value="p">{{ SOCIAL_PLATFORM_LABELS[p] || t('admin.home.otherPlatform') }}</option>
            </select>
          </label>
          <LocalizedInput v-model="item.label" :label="t('admin.home.f.linkLabel')" :max="L.labelMax" />
          <label class="flex flex-col gap-1.5 text-sm font-medium">
            URL<input v-model="item.url" class="field font-mono" type="url" :maxlength="L.urlMax" placeholder="https://" :aria-invalid="(item.url && !isUrl(item.url)) || undefined" />
          </label>
        </template>
      </ItemList>
    </template>

    <template v-else-if="s.type === 'fanart'">
      <label class="flex flex-col gap-1.5 text-sm font-medium">
        {{ t('admin.home.f.count') }}
        <input v-model.number="s.data.count" class="field w-28" type="number" :min="L.fanartMin" :max="L.fanartMax" data-test="f-count" />
        <span class="text-xs font-normal text-[var(--c-muted)]">{{ t('admin.home.fanartHint') }}</span>
      </label>
    </template>

    <template v-else-if="s.type === 'banner'">
      <LocalizedInput v-model="s.data.eyebrow" :label="t('admin.home.f.eyebrow')" :max="L.eyebrowMax" />
      <LocalizedInput v-model="s.data.text" :label="t('admin.home.f.quote')" :max="L.subtitleMax" multiline required :hint="t('admin.home.hashtagHint')" test-id="f-quote" />
      <LocalizedInput v-model="s.data.attribution" :label="t('admin.home.f.attribution')" :max="L.labelMax" />
      <SiteImageField v-model="s.data.image" :label="t('admin.home.f.image')" />
      <label class="flex items-center gap-2 text-sm font-medium">
        <input type="checkbox" :checked="!!s.data.cta" @change="s.data.cta = ($event.target as HTMLInputElement).checked ? { label: lt(), href: '/posts' } : null" />
        {{ t('admin.home.f.withCta') }}
      </label>
      <template v-if="s.data.cta">
        <LocalizedInput v-model="s.data.cta.label" :label="t('admin.home.f.ctaLabel')" :max="L.labelMax" required />
        <label class="flex flex-col gap-1.5 text-sm font-medium">
          {{ t('admin.home.f.href') }}<input v-model="s.data.cta.href" class="field font-mono" type="text" :maxlength="L.urlMax" :aria-invalid="!isHref(s.data.cta.href) || undefined" />
        </label>
      </template>
    </template>
  </div>
</template>
