import 'reflect-metadata'
import { registerSchema } from '@cuka/shared'
import * as argon2 from 'argon2'
import { getModelToken } from '@nestjs/mongoose'
import type { Model } from 'mongoose'
import { createAppContext } from '../app.module'
import { type Config, loadConfig } from '../config/config'
import { loadEnvFile } from '../config/env-file'
import { USER_MODEL, type User } from '../users/user.schema'

export interface CreateAdminInput {
  email: string
  password: string
  username: string
}

/** Creates a verified admin, or promotes (and verifies) the existing user with that email. Returns the user id. */
export async function createAdmin(cfg: Config, input: CreateAdminInput): Promise<string> {
  const parsed = registerSchema.parse({ ...input, displayName: input.username })
  const app = await createAppContext(cfg)
  try {
    const users = app.get<Model<User>>(getModelToken(USER_MODEL))
    const email = parsed.email.trim().toLowerCase()
    const existing = await users.findOne({ email })
    if (existing) {
      existing.role = 'admin'
      existing.emailVerifiedAt ??= new Date()
      await existing.save()
      return existing._id.toString()
    }
    const user = await users.create({
      email,
      passwordHash: await argon2.hash(parsed.password, { type: argon2.argon2id }),
      role: 'admin',
      emailVerifiedAt: new Date(),
      profile: { username: parsed.username, displayName: parsed.username },
    })
    return user._id.toString()
  } finally {
    await app.close()
  }
}

function parseArgs(argv: string[]): Partial<CreateAdminInput> {
  const out: Record<string, string> = {}
  for (let i = 0; i < argv.length; i++) {
    const m = /^--(email|password|username)(?:=(.*))?$/.exec(argv[i]!)
    if (m) out[m[1]!] = m[2] ?? argv[++i] ?? ''
  }
  return out
}

if (require.main === module) {
  loadEnvFile()
  const args = parseArgs(process.argv.slice(2))
  if (!args.email || !args.password || !args.username) {
    console.error('Usage: create-admin --email <email> --password <password> --username <username>')
    process.exit(1)
  }
  createAdmin(loadConfig(process.env), args as CreateAdminInput)
    .then((id) => console.log(`admin ready: ${id}`))
    .catch((err) => {
      console.error(err)
      process.exit(1)
    })
}
