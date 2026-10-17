import { Global, Module } from '@nestjs/common'
import { getConnectionToken } from '@nestjs/mongoose'
import type mongoose from 'mongoose'
import { AgendaJobs } from './agenda-jobs'
import { JOBS } from './jobs.port'

@Global()
@Module({
  providers: [{ provide: JOBS, inject: [getConnectionToken()], useFactory: (conn: mongoose.Connection) => new AgendaJobs(conn) }],
  exports: [JOBS],
})
export class JobsModule {}
