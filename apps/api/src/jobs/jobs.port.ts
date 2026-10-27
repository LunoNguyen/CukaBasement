export const JOBS = Symbol('JOBS')

export type JobName =
  | 'process-file'
  | 'relocate-variants'
  | 'relocate-file'
  | 'rewatermark'
  | 'cleanup-uploads'
  | 'purge-deleted-posts'
  | 'reconcile-counters'
  | 'notify-staff-review'
  | 'youtube-sync'

export interface JobsPort {
  enqueue(name: JobName, data: Record<string, unknown>): Promise<void>
}
