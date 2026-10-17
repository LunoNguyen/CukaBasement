import 'reflect-metadata'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { NestFactory } from '@nestjs/core'
import { AppModule, configureApp } from './app.module'
import { CONFIG, type Config } from './config/config'

async function bootstrap(): Promise<void> {
  const envFile = resolve(__dirname, '../../../.env')
  if (existsSync(envFile)) process.loadEnvFile(envFile)
  const app = await NestFactory.create(AppModule)
  const config = app.get<Config>(CONFIG)
  configureApp(app, config)
  app.enableShutdownHooks()
  await app.listen(config.apiPort)
}

void bootstrap()
