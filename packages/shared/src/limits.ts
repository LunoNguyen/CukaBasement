export const LIMITS = {
  titleMax: 100,
  descriptionMax: 3000,
  commentMax: 1000,
  bioMax: 500,
  displayNameMax: 50,
  tagMax: 30,
  tagsPerPost: 10,
  passwordMin: 8,
  pageSizeDefault: 30,
  pageSizeMax: 100,
  rejectReasonMax: 500,
  reportDetailMax: 1000,
  adminNoteMax: 500,
  creditArtistNameMax: 100,
  creditArtistHandleMax: 100,
  creditSourceUrlMax: 500,
  creditPermissionNoteMax: 300,
  socialLinksMax: 10,
  socialLinkLabelMax: 40,
  socialLinkUrlMax: 500,
} as const

export const DEFAULT_SETTINGS = {
  reportHideThreshold: 5,
  reportAiHideThreshold: 3,
  maxFileBytes: 52428800,
  maxFilesPerPost: 50,
  dailyUploadQuotaBytes: 2147483648,
}

export type GlobalSettings = typeof DEFAULT_SETTINGS
