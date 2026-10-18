import 'reflect-metadata'
import { Client } from 'minio'
import { getConnectionToken } from '@nestjs/mongoose'
import type mongoose from 'mongoose'
import { createAppContext } from '../app.module'
import { type Config, loadConfig } from '../config/config'
import { loadEnvFile } from '../config/env-file'
import { ensureBuckets, prepareDatabase } from '../database/prepare'

export async function runSetup(cfg: Config, log: (line: string) => void = () => {}): Promise<void> {
  const app = await createAppContext(cfg)
  try {
    await prepareDatabase(app.get<mongoose.Connection>(getConnectionToken()), log)
  } finally {
    await app.close()
  }

  const m = cfg.minio
  const client = new Client({ endPoint: m.endPoint, port: m.port, useSSL: m.useSSL, accessKey: m.accessKey, secretKey: m.secretKey })
  await ensureBuckets(client, m, log)
}

if (require.main === module) {
  loadEnvFile()
  runSetup(loadConfig(process.env), (l) => console.log(l))
    .then(() => console.log('setup complete'))
    .catch((err) => {
      console.error(err)
      process.exit(1)
    })
}
