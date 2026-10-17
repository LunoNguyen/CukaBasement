import { Controller, Get, Global, type INestApplication, Module } from '@nestjs/common'
import cookieParser from 'cookie-parser'
import { APP_FILTER } from '@nestjs/core'
import { GlobalErrorFilter } from './common/error.filter'
import { CONFIG, type Config, loadConfig } from './config/config'
import { DatabaseModule } from './database/database.module'
import { JobsModule } from './jobs/jobs.module'
import { MailModule } from './mail/mail.module'
import { SettingsModule } from './settings/settings.module'
import { StorageModule } from './storage/storage.module'

@Global()
@Module({
  providers: [{ provide: CONFIG, useFactory: () => loadConfig(process.env) }],
  exports: [CONFIG],
})
export class ConfigModule {}

@Controller('health')
export class HealthController {
  @Get()
  health() {
    return { ok: true }
  }
}

@Module({
  imports: [ConfigModule, DatabaseModule, MailModule, JobsModule, SettingsModule, StorageModule],
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
