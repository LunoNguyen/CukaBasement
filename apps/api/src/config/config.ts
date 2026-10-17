import { z } from 'zod'

export const CONFIG = Symbol('CONFIG')

const bool = z.enum(['true', 'false']).transform((v) => v === 'true')

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  MONGODB_URI: z.string().min(1).default('mongodb://localhost:27017/CukaDB'),
  MINIO_ENDPOINT: z.string().min(1).default('localhost'),
  MINIO_PORT: z.coerce.number().int().positive().default(9000),
  MINIO_USE_SSL: bool.default(false),
  MINIO_ACCESS_KEY: z.string().min(1).default('minioadmin'),
  MINIO_SECRET_KEY: z.string().min(1).default('minioadmin'),
  MINIO_PUBLIC_URL: z.url().default('http://localhost:9000'),
  MINIO_BUCKET_ORIGINALS: z.string().min(1).default('cuka-originals'),
  MINIO_BUCKET_PUBLIC: z.string().min(1).default('cuka-public'),
  JWT_ACCESS_SECRET: z.string().min(1).default('change-me'),
  JWT_REFRESH_SECRET: z.string().min(1).default('change-me'),
  SMTP_URL: z.string().optional(),
  MAIL_FROM: z.string().min(1).default('CukaBasement <no-reply@localhost>'),
  APP_URL: z.url().default('http://localhost:5173'),
  API_PORT: z.coerce.number().int().positive().default(3000),
  FFMPEG_PATH: z.string().min(1).default('ffmpeg'),
  FFPROBE_PATH: z.string().optional(),
})

export interface Config {
  nodeEnv: 'development' | 'production' | 'test'
  mongoUri: string
  minio: {
    endPoint: string
    port: number
    useSSL: boolean
    accessKey: string
    secretKey: string
    publicUrl: string
    bucketOriginals: string
    bucketPublic: string
  }
  jwt: { accessSecret: string; refreshSecret: string }
  smtpUrl?: string
  mailFrom: string
  appUrl: string
  apiPort: number
  ffmpegPath: string
  ffprobePath: string
}

/** Derives the ffprobe path from the ffmpeg path by replacing the last `ffmpeg` in the file name. */
function deriveFfprobe(ffmpegPath: string): string {
  const i = ffmpegPath.lastIndexOf('ffmpeg')
  return i < 0 ? 'ffprobe' : ffmpegPath.slice(0, i) + 'ffprobe' + ffmpegPath.slice(i + 'ffmpeg'.length)
}

export function loadConfig(env: NodeJS.ProcessEnv): Config {
  // Empty strings (e.g. `SMTP_URL=` in .env) are treated as unset.
  const cleaned = Object.fromEntries(Object.entries(env).filter(([, v]) => v !== undefined && v !== ''))
  const e = envSchema.parse(cleaned)
  return {
    nodeEnv: e.NODE_ENV,
    mongoUri: e.MONGODB_URI,
    minio: {
      endPoint: e.MINIO_ENDPOINT,
      port: e.MINIO_PORT,
      useSSL: e.MINIO_USE_SSL,
      accessKey: e.MINIO_ACCESS_KEY,
      secretKey: e.MINIO_SECRET_KEY,
      publicUrl: e.MINIO_PUBLIC_URL,
      bucketOriginals: e.MINIO_BUCKET_ORIGINALS,
      bucketPublic: e.MINIO_BUCKET_PUBLIC,
    },
    jwt: { accessSecret: e.JWT_ACCESS_SECRET, refreshSecret: e.JWT_REFRESH_SECRET },
    smtpUrl: e.SMTP_URL,
    mailFrom: e.MAIL_FROM,
    appUrl: e.APP_URL,
    apiPort: e.API_PORT,
    ffmpegPath: e.FFMPEG_PATH,
    ffprobePath: e.FFPROBE_PATH ?? deriveFfprobe(e.FFMPEG_PATH),
  }
}
