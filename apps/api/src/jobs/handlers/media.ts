import { spawn } from 'node:child_process'
import { rm, stat } from 'node:fs/promises'
import type mongoose from 'mongoose'
import type { Config } from '../../config/config'
import type { StorageService } from '../../storage/storage.service'

export type JobDeps = { conn: mongoose.Connection; storage: StorageService; config: Config }

export const MEDIA_TIMEOUT_MS = 60_000

export class MediaTimeoutError extends Error {}

/** Runs a binary to completion; rejects with its stderr on a non-zero exit, or SIGKILLs it after `timeoutMs`. */
export function run(bin: string, args: string[], timeoutMs = MEDIA_TIMEOUT_MS): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    const out: Buffer[] = []
    const err: Buffer[] = []
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGKILL')
    }, timeoutMs)
    child.stdout.on('data', (c: Buffer) => out.push(c))
    child.stderr.on('data', (c: Buffer) => err.push(c))
    child.on('error', (e) => {
      clearTimeout(timer)
      reject(e)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (timedOut) reject(new MediaTimeoutError(`${bin} timed out after ${timeoutMs}ms and was killed`))
      else if (code === 0) resolve(Buffer.concat(out).toString('utf8'))
      else reject(new Error(`${bin} exited with ${code}: ${Buffer.concat(err).toString('utf8').trim()}`))
    })
  })
}

interface ProbeOutput {
  format?: { duration?: string }
  streams?: Array<{ codec_type?: string; width?: number; height?: number }>
}

export async function probe(path: string, ffprobePath: string): Promise<{ durationSec: number; width?: number; height?: number }> {
  const json = JSON.parse(await run(ffprobePath, ['-v', 'error', '-protocol_whitelist', 'file', '-print_format', 'json', '-show_format', '-show_streams', path])) as ProbeOutput
  const durationSec = Number(json.format?.duration)
  if (!Number.isFinite(durationSec)) throw new Error(`ffprobe reported no duration for ${path}`)
  const video = json.streams?.find((s) => s.codec_type === 'video')
  return { durationSec, width: video?.width, height: video?.height }
}

/** Writes one frame at `atSec` to `outPath`; when the clip is shorter than `atSec` the first frame is used. */
export async function extractFrame(path: string, outPath: string, atSec: number, ffmpegPath: string): Promise<void> {
  const grab = (at: number) => run(ffmpegPath, ['-nostdin', '-v', 'error', '-y', '-ss', String(at), '-protocol_whitelist', 'file', '-i', path, '-frames:v', '1', outPath])
  await rm(outPath, { force: true })
  // Seeking past the end writes no frame (or fails, depending on the muxer): fall back to the first frame.
  const ok = await grab(atSec).then(
    () => nonEmpty(outPath),
    (e: unknown) => {
      if (e instanceof MediaTimeoutError) throw e
      return false
    },
  )
  if (!ok && atSec > 0) await grab(0)
  if (!(await nonEmpty(outPath))) throw new Error(`ffmpeg extracted no frame from ${path}`)
}

async function nonEmpty(path: string): Promise<boolean> {
  try {
    return (await stat(path)).size > 0
  } catch {
    return false
  }
}
