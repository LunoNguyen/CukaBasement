import { Controller, Get, Global, type INestApplication, Module } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import cookieParser from 'cookie-parser'
import { APP_FILTER } from '@nestjs/core'
import { ThrottlerModule } from '@nestjs/throttler'
import { AdminModule } from './admin/admin.module'
import { AuthModule } from './auth/auth.module'
import { BackupModule } from './backup/backup.module'
import { MaintenanceModule, MaintenanceService } from './backup/maintenance.service'
import { CacheModule } from './cache/cache.module'
import { GlobalErrorFilter } from './common/error.filter'
import { CONFIG, type Config, loadConfig } from './config/config'
import { DatabaseModule } from './database/database.module'
import { CommentsModule } from './comments/comments.module'
import { FeedModule } from './feed/feed.module'
import { InteractionsModule } from './interactions/interactions.module'
import { JobsModule } from './jobs/jobs.module'
import { MailModule } from './mail/mail.module'
import { ModerationModule } from './moderation/moderation.module'
import { OgModule } from './og/og.module'
import { NotificationsModule } from './notifications/notifications.module'
import { PostsModule } from './posts/posts.module'
import { ReportsModule } from './reports/reports.module'
import { SettingsModule } from './settings/settings.module'
import { StorageModule } from './storage/storage.module'
import { UploadsModule } from './uploads/uploads.module'

/** Set only while createAppContext boots, so non-HTTP entry points can supply their own Config. */
let configOverride: Config | undefined

@Global()
@Module({
  providers: [{ provide: CONFIG, useFactory: () => configOverride ?? loadConfig(process.env) }],
  exports: [CONFIG],
})
export class ConfigModule {}

@Controller('health')
export class HealthController {
  constructor(private readonly maintenance: MaintenanceService) {}

  /** `maintenance` is true while a restore runs; the web polls this to know when the site is back. */
  @Get()
  async health() {
    return { ok: true, maintenance: await this.maintenance.active() }
  }
}

@Module({
  imports: [
    ConfigModule,
    DatabaseModule,
    MaintenanceModule,
    MailModule,
    JobsModule,
    SettingsModule,
    StorageModule,
    CacheModule,
    // Limits apply only where a route opts in with @UseGuards(ThrottlerGuard) + @Throttle.
    ThrottlerModule.forRootAsync({
      inject: [CONFIG],
      useFactory: (config: Config) => ({
        throttlers: [{ name: 'default', limit: 60, ttl: 60_000 }],
        skipIf: () => config.throttleDisabled,
      }),
    }),
    AuthModule,
    UploadsModule,
    PostsModule,
    FeedModule,
    NotificationsModule,
    InteractionsModule,
    CommentsModule,
    ReportsModule,
    ModerationModule,
    AdminModule,
    BackupModule,
    OgModule,
  ],
  controllers: [HealthController],
  providers: [{ provide: APP_FILTER, useClass: GlobalErrorFilter }],
})
export class AppModule {}

/** Shared by main and the test harness so both serve the same HTTP surface. */
export function configureApp(app: INestApplication, config: Config): void {
  app.setGlobalPrefix('api', { exclude: ['og/{*path}'] })
  app.use(cookieParser())
  app.enableCors({ origin: config.appUrl, credentials: true })
}

/** Boots the full module graph without HTTP (used by the setup script) with an explicit Config. */
export async function createAppContext(cfg: Config) {
  configOverride = cfg
  try {
    return await NestFactory.createApplicationContext(AppModule, { logger: ['warn', 'error'] })
  } finally {
    configOverride = undefined
  }
}
