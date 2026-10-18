<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { PLATFORM_LABELS, artistTag } from '@cuka/shared'
import type { AuthorDto } from '@/api/types'
import type { PostCardDto } from '@/api/types'

const props = defineProps<{ credit: PostCardDto['credit']; author: Pick<AuthorDto, 'username'> }>()
const { t } = useI18n()

const who = computed(() => artistTag(props.credit))
const label = computed(() => PLATFORM_LABELS[props.credit.platform])
</script>

<template>
  <span v-if="credit.isOwnWork">© @{{ author.username }}</span>
  <span v-else>
    {{ t('post.artBy') }}
    <a
      v-if="credit.sourceUrl"
      :href="credit.sourceUrl"
      target="_blank"
      rel="noopener noreferrer nofollow"
      class="underline"
      @click.stop
      >{{ who }}</a
    ><template v-else>{{ who }}</template
    ><template v-if="label"> · {{ label }}</template>
  </span>
</template>
