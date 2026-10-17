import type { OnModuleDestroy } from '@nestjs/common'
import { MongoBackend } from '@agendajs/mongo-backend'
import { Agenda } from 'agenda'
import type mongoose from 'mongoose'
import type { JobName, JobsPort } from './jobs.port'

/** Agenda-backed queue in the `jobs` collection. The API only enqueues; the worker defines and starts it. */
export class AgendaJobs implements JobsPort, OnModuleDestroy {
  private instance?: Agenda

  constructor(private readonly conn: mongoose.Connection) {}

  /** Created on first use: constructing Agenda starts connecting (index builds), which must not race shutdown. */
  get agenda(): Agenda {
    return (this.instance ??= new Agenda({ backend: new MongoBackend({ mongo: this.conn.db!, collection: 'jobs' }) }))
  }

  async enqueue(name: JobName, data: Record<string, unknown>): Promise<void> {
    await this.agenda.ready
    await this.agenda.now(name, data)
  }

  /** Runs before Mongoose closes its connection, so an in-flight connect cannot be interrupted. */
  async onModuleDestroy(): Promise<void> {
    await this.instance?.ready
  }
}
