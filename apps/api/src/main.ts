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
  // Behind a reverse proxy (the Docker stack's nginx) req.ip would be the proxy for every client, so rate limits keyed
  // on it would lump everyone together. TRUST_PROXY is the number of proxy hops to trust (Express 'trust proxy').
  const hops = Number(process.env.TRUST_PROXY)
  if (Number.isInteger(hops) && hops > 0) app.getHttpAdapter().getInstance().set('trust proxy', hops)
  // Node's 5-minute default would cut off uploading a multi-GB backup from the admin page.
  app.getHttpServer().requestTimeout = 2 * 60 * 60 * 1000
  await app.listen(config.apiPort)
}

void bootstrap()
