export const LIMITS = {
  titleMax: 100,
  descriptionMax: 3000,
  commentMax: 1000,
  bioMax: 500,
  tagMax: 30,
  tagsPerPost: 10,
  passwordMin: 8,
  pageSizeDefault: 30,
  pageSizeMax: 100,
} as const

export const DEFAULT_SETTINGS = {
  reportHideThreshold: 5,
  reportAiHideThreshold: 3,
  maxFileBytes: 52428800,
  maxFilesPerPost: 50,
  dailyUploadQuotaBytes: 2147483648,
}

export type GlobalSettings = typeof DEFAULT_SETTINGS
