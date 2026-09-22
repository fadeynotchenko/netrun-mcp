/**
 * Публикация через MCP на фейковом API: без секретов агент получает
 * needs_secrets, с секретами — создание, ожидание сборки и ссылку;
 * провал приносит причину из ленты событий.
 */
import { mkdtemp, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { describe, expect, it } from 'vitest'

import { NetrunApi, type Preflight, type Project, type ProjectEvent } from '../src/api.js'
import type { Config } from '../src/config.js'
import { createServer } from '../src/server.js'

const cfg: Config = { apiKey: 'nru_x', apiUrl: 'https://api.test/v1', appUrl: 'https://app.test', clientName: 'mcp/test' }

function project(over: Partial<Project> = {}): Project {
  return {
    id: 42,
    name: 'mybot',
    slug: 'mybot',
    status: 'running',
    runtime: 'python',
    app_kind: 'bot',
    host_url: null,
    last_error: null,
    files_count: 2,
    updated_at: '2026-09-20T00:00:00Z',
    is_blocked: false,
    admin_blocked: false,
    disk_blocked: false,
    trial_stopped: false,
    ...over,
  }
}

class FakeApi extends NetrunApi {
  statuses: string[] = ['building', 'running']
  created: unknown[] = []
  events: ProjectEvent[] = []
  preflightResult: Preflight = {
    preflight_id: 'pf-1',
    layout: 'auto',
    compose_files: [],
    missing_env_files: ['.env'],
    optional_env_files: ['.env'],
    env_templates: {},
    env_templates_kv: { '.env': { BOT_TOKEN: '' } },
    warnings: [],
  }
  constructor() {
    super(cfg, (async () => new Response('{}')) as unknown as typeof fetch)
  }
  override async checkName() {
    return { available: true, slug: 'mybot', reason: null }
  }
  override async preflight() {
    return this.preflightResult
  }
  override async createProject(input: unknown) {
    this.created.push(input)
    return project({ status: 'queued' })
  }
  override async getProject() {
    const status = this.statuses.length > 1 ? this.statuses.shift()! : this.statuses[0]
    return project({ status })
  }
  override async eventsHistory() {
    return this.events
  }
}

async function connect(api: FakeApi) {
  const server = createServer(api, cfg)
  const [clientT, serverT] = InMemoryTransport.createLinkedPair()
  await server.connect(serverT)
  const client = new Client({ name: 'test', version: '0' })
  await client.connect(clientT)
  return client
}

async function tmpProject(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'netrun-pub-'))
  await writeFile(path.join(root, 'bot.py'), 'import os\nos.getenv("BOT_TOKEN")\n')
  return root
}

function payload(result: Awaited<ReturnType<Client['callTool']>>): Record<string, unknown> {
  const content = result.content as { type: string; text: string }[]
  return JSON.parse(content[0].text) as Record<string, unknown>
}

describe('netrun_publish', () => {
  it('lists the tools the agent gets — and no delete/pay', async () => {
    const client = await connect(new FakeApi())
    const tools = (await client.listTools()).tools.map((t) => t.name).sort()
    expect(tools).toEqual([
      'netrun_control',
      'netrun_list_projects',
      'netrun_logs',
      'netrun_publish',
      'netrun_set_secrets',
      'netrun_status',
      'netrun_whoami',
    ])
  })

  it('asks for required secrets before creating anything', async () => {
    const api = new FakeApi()
    api.preflightResult.optional_env_files = [] // compose-style: обязательный .env
    const client = await connect(api)
    const res = payload(await client.callTool({ name: 'netrun_publish', arguments: { path: await tmpProject(), name: 'mybot' } }))
    expect(res.needs_secrets).toBe(true)
    expect(res.required).toEqual([{ file: '.env', keys: ['BOT_TOKEN'] }])
    expect(api.created).toHaveLength(0)
  })

  it('asks about env variables found in the code, and publishes only with skip_secrets or values', async () => {
    const api = new FakeApi() // optional_env_files = ['.env'] — ключ найден в коде
    const client = await connect(api)
    const folder = await tmpProject()
    const asked = payload(await client.callTool({ name: 'netrun_publish', arguments: { path: folder, name: 'mybot' } }))
    expect(asked.needs_secrets).toBe(true)
    expect(asked.can_skip).toBe(true)
    expect(asked.optional).toEqual([{ file: '.env', keys: ['BOT_TOKEN'] }])
    expect(api.created).toHaveLength(0)

    const skipped = payload(
      await client.callTool({ name: 'netrun_publish', arguments: { path: folder, name: 'mybot', skip_secrets: true, wait: false } }),
    )
    expect(skipped.accepted).toBe(true)
    expect(api.created).toHaveLength(1)
    expect((api.created[0] as { envFiles?: unknown }).envFiles).toBeUndefined()
  })

  it('creates the project with secrets as a .env, waits for the build and reports the result', async () => {
    const api = new FakeApi()
    const client = await connect(api)
    const res = payload(
      await client.callTool({
        name: 'netrun_publish',
        arguments: { path: await tmpProject(), name: 'mybot', secrets: { BOT_TOKEN: '123:abc def' }, wait_seconds: 10 },
      }),
    )
    expect(api.created).toHaveLength(1)
    const input = api.created[0] as { envFiles: Record<string, string>; preflightId: string }
    expect(input.preflightId).toBe('pf-1')
    expect(input.envFiles['.env']).toBe('BOT_TOKEN="123:abc def"\n')
    const proj = res.project as Record<string, unknown>
    expect(proj.status).toBe('running')
    expect(String(res.next)).toMatch(/bot is running/i)
  })

  it('brings the failure reason from the event history', async () => {
    const api = new FakeApi()
    api.statuses = ['failed']
    api.events = [
      {
        id: 1,
        kind: 'step',
        step: 'build',
        state: 'failed',
        message: 'Сборка упала',
        meta: { stage: 'build', short_reason_en: 'pip install failed', explanation_en: 'aiogram==99 does not exist', stderr_tail: 'ERROR: No matching distribution' },
        created_at: '2026-09-20T00:00:00Z',
      },
    ]
    const client = await connect(api)
    const res = payload(
      await client.callTool({
        name: 'netrun_publish',
        arguments: { path: await tmpProject(), name: 'mybot', secrets: { BOT_TOKEN: 'x' }, wait_seconds: 10 },
      }),
    )
    const failure = res.failure as Record<string, unknown>
    expect(failure.reason).toBe('pip install failed')
    expect(failure.stderr_tail).toContain('No matching distribution')
  })

  it('tells the agent where the human must go when the platform says interactive_required', async () => {
    const api = new FakeApi()
    api.control = async () => {
      throw Object.assign(new (await import('../src/api.js')).ApiError(403, 'x', 'interactive_required', null))
    }
    const client = await connect(api)
    const result = await client.callTool({ name: 'netrun_control', arguments: { project_id: 42, action: 'stop' } })
    expect(result.isError).toBe(true)
    const res = payload(result)
    expect(res.error).toBe('interactive_required')
    expect(String(res.dashboard)).toContain('https://app.test')
  })
})
