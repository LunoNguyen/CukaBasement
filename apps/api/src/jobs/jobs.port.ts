export const JOBS = Symbol('JOBS')

export type JobName =
  | 'process-file'
  | 'relocate-variants'
  | 'rewatermark'
  | 'cleanup-uploads'
  | 'purge-deleted-posts'
  | 'reconcile-counters'

export interface JobsPort {
  enqueue(name: JobName, data: Record<string, unknown>): Promise<void>
}
