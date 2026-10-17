import 'reflect-metadata'
import { NestFactory } from '@nestjs/core'
import { AppModule, configureApp } from './app.module'
import { CONFIG, type Config } from './config/config'
import { loadEnvFile } from './config/env-file'

async function bootstrap(): Promise<void> {
  loadEnvFile()
  const app = await NestFactory.create(AppModule)
  const config = app.get<Config>(CONFIG)
  configureApp(app, config)
  app.enableShutdownHooks()
  await app.listen(config.apiPort)
}

void bootstrap()
