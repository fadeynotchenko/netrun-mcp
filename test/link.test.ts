/**
 * `netrun_link` — «мне нужна ссылка» из редактора.
 *
 * Прод, октябрь 2026: бот, переписанный на вебхуки, платформа считала
 * фоновой программой, а кнопка «Мне нужна ссылка» была только в кабинете.
 *
 * Сторож трёх вещей:
 *   1. действие зовёт ту же ручку, что кнопка (`PUT /app-kind`), и отдаёт
 *      агенту адрес, когда он появился;
 *   2. если приложение не ответило ни на один запрос, агент получает
 *      ПРИЧИНУ (0.0.0.0 и порт из PORT), а не повод звать снова;
 *   3. «ссылка не нужна» уводит проект в фон тем же действием.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { describe, expect, it } from 'vitest'

import { NetrunApi, type Project } from '../src/api.js'
import type { Config } from '../src/config.js'
import { createServer } from '../src/server.js'

const cfg: Config = {
  apiKey: 'nru_x',
  apiUrl: 'https://api.test/v1',
  appUrl: 'https://app.test',
  clientName: 'mcp/test',
}

function project(over: Partial<Project> = {}): Project {
  return {
    id: 7,
    name: 'hook-bot',
    slug: 'hook-bot',
    status: 'running',
    runtime: 'node',
    app_kind: 'bot',
    host_url: null,
    last_error: null,
    files_count: 3,
    updated_at: '2026-10-05T00:00:00Z',
    is_blocked: false,
    admin_blocked: false,
    disk_blocked: false,
    trial_stopped: false,
    ...over,
  }
}

class FakeApi extends NetrunApi {
  calls: boolean[] = []
  /** Каким проект окажется после повторной публикации. */
  after: Project = project()

  constructor() {
    super(cfg, (async () => new Response('{}')) as unknown as typeof fetch)
  }
  override async setLink(_id: number, needed: boolean) {
    this.calls.push(needed)
    return project({ status: 'queued', app_kind: needed ? 'web' : 'script', app_kind_pinned: needed ? 'web' : 'script' })
  }
  override async getProject() {
    return this.after
  }
  override async eventsHistory() {
    return []
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

function payload(result: Awaited<ReturnType<Client['callTool']>>): Record<string, unknown> {
  const content = result.content as { type: string; text: string }[]
  return JSON.parse(content[0].text) as Record<string, unknown>
}

describe('netrun_link', () => {
  it('asks for a link and returns the address once it is live', async () => {
    const api = new FakeApi()
    api.after = project({ app_kind: 'web', app_kind_pinned: 'web', host_url: 'https://hook-bot.de1.netrun.io' })
    const client = await connect(api)
    const res = payload(await client.callTool({ name: 'netrun_link', arguments: { project_id: 7, needed: true } }))
    expect(api.calls).toEqual([true])
    expect(res.link).toBe('https://hook-bot.de1.netrun.io')
    expect(String(res.next)).toContain('setWebhook')
    expect((res.project as Record<string, unknown>).link_choice).toBe('public link requested')
  })

  it('names the fix when the app did not answer, instead of inviting a retry', async () => {
    const api = new FakeApi()
    // Мягкая посадка: тип не web, выбор снят, проект работает в фоне.
    api.after = project({ app_kind: 'bot', app_kind_pinned: null })
    const client = await connect(api)
    const res = await client.callTool({ name: 'netrun_link', arguments: { project_id: 7, needed: true } })
    expect(res.isError).toBeFalsy()
    const out = payload(res)
    expect(out.link_confirmed).toBe(false)
    expect(String(out.next)).toContain('0.0.0.0')
    expect(String(out.next)).toContain('PORT')
  })

  it('turns the link off with the same action', async () => {
    const api = new FakeApi()
    api.after = project({ app_kind: 'script', app_kind_pinned: 'script' })
    const client = await connect(api)
    const res = payload(await client.callTool({ name: 'netrun_link', arguments: { project_id: 7, needed: false } }))
    expect(api.calls).toEqual([false])
    expect(String(res.next)).toContain('without a public address')
  })
})
