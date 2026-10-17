import { Global, Module } from '@nestjs/common'
import { JOBS, type JobsPort } from './jobs.port'

/** Placeholder until AgendaJobs (Task 9): enqueue is a no-op. */
const noopJobs: JobsPort = { enqueue: async () => {} }

@Global()
@Module({
  providers: [{ provide: JOBS, useValue: noopJobs }],
  exports: [JOBS],
})
export class JobsModule {}
