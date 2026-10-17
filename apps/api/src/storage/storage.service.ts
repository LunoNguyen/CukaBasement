import { Inject, Injectable } from '@nestjs/common'
import type { VariantName } from '@cuka/shared'
import { Client } from 'minio'
import { pipeline } from 'node:stream/promises'
import { createWriteStream } from 'node:fs'
import { CONFIG, type Config } from '../config/config'

const POST_EXPIRY_SECONDS = 15 * 60
const GET_EXPIRY_SECONDS = 10 * 60

function isNotFound(err: unknown): boolean {
  const code = (err as { code?: string })?.code
  return code === 'NotFound' || code === 'NoSuchKey' || code === 'NoSuchBucket'
}

async function streamToBuffer(stream: AsyncIterable<Buffer | string>): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const c of stream) chunks.push(typeof c === 'string' ? Buffer.from(c) : c)
  return Buffer.concat(chunks)
}

@Injectable()
export class StorageService {
  readonly client: Client
  /** Used only for presigning, so signed URLs carry the browser-reachable public host. */
  private readonly signer: Client

  constructor(@Inject(CONFIG) private readonly config: Config) {
    const m = config.minio
    this.client = new Client({ endPoint: m.endPoint, port: m.port, useSSL: m.useSSL, accessKey: m.accessKey, secretKey: m.secretKey })
    const pub = new URL(m.publicUrl)
    this.signer = new Client({
      endPoint: pub.hostname,
      port: pub.port ? Number(pub.port) : pub.protocol === 'https:' ? 443 : 80,
      useSSL: pub.protocol === 'https:',
      accessKey: m.accessKey,
      secretKey: m.secretKey,
      region: 'us-east-1',
    })
  }

  async presignPost(bucket: string, key: string, maxBytes: number, contentType: string): Promise<{ url: string; fields: Record<string, string> }> {
    const policy = this.signer.newPostPolicy()
    policy.setBucket(bucket)
    policy.setKey(key)
    policy.setContentType(contentType)
    policy.setContentLengthRange(1, maxBytes)
    policy.setExpires(new Date(Date.now() + POST_EXPIRY_SECONDS * 1000))
    const { postURL, formData } = await this.signer.presignedPostPolicy(policy)
    return { url: postURL, fields: formData }
  }

  presignGet(bucket: string, key: string, opts: { downloadName?: string } = {}): Promise<string> {
    const params = opts.downloadName
      ? { 'response-content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(opts.downloadName)}` }
      : undefined
    return this.signer.presignedGetObject(bucket, key, GET_EXPIRY_SECONDS, params)
  }

  async stat(bucket: string, key: string): Promise<{ size: number } | null> {
    try {
      const s = await this.client.statObject(bucket, key)
      return { size: s.size }
    } catch (err) {
      if (isNotFound(err)) return null
      throw err
    }
  }

  async readHead(bucket: string, key: string, bytes: number): Promise<Buffer> {
    return streamToBuffer(await this.client.getPartialObject(bucket, key, 0, bytes))
  }

  async getBuffer(bucket: string, key: string): Promise<Buffer> {
    return streamToBuffer(await this.client.getObject(bucket, key))
  }

  async getToFile(bucket: string, key: string, path: string): Promise<void> {
    await pipeline(await this.client.getObject(bucket, key), createWriteStream(path))
  }

  async put(bucket: string, key: string, body: Buffer, contentType: string): Promise<void> {
    await this.client.putObject(bucket, key, body, body.length, { 'Content-Type': contentType })
  }

  async remove(bucket: string, key: string): Promise<void> {
    try {
      await this.client.removeObject(bucket, key)
    } catch (err) {
      if (!isNotFound(err)) throw err
    }
  }

  async copy(srcBucket: string, srcKey: string, dstBucket: string, dstKey: string): Promise<void> {
    await this.client.copyObject(dstBucket, dstKey, `/${srcBucket}/${srcKey}`)
  }

  publicUrl(key: string): string {
    return `${this.config.minio.publicUrl}/${this.config.minio.bucketPublic}/${key}`
  }

  objectKey(userId: string, fileId: string, name: 'original' | VariantName, ext: string): string {
    return `${userId}/${fileId}/${name}.${ext}`
  }
}
