/**
 * Свой домен и имена уже заданных секретов — два действия, которых агенту
 * не хватало больше всего.
 *
 * Сторож трёх вещей:
 *   1. агент получает DNS-записи СЛОВАМИ, которые можно передать человеку,
 *      и подсказку «не крутите проверку в цикле»;
 *   2. отвязки домена у агента нет вовсе — необратимое остаётся человеку;
 *   3. статус показывает ИМЕНА секретов и никогда значения: без этого
 *      агент переспрашивает токен, который человек уже вписал.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { describe, expect, it } from 'vitest'

import { NetrunApi, type DomainsState, type Project } from '../src/api.js'
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
    name: 'site',
    slug: 'site',
    status: 'running',
    runtime: 'static',
    app_kind: 'web',
    host_url: 'https://site.n1.netrun.io',
    last_error: null,
    files_count: 3,
    updated_at: '2026-09-20T00:00:00Z',
    is_blocked: false,
    admin_blocked: false,
    disk_blocked: false,
    trial_stopped: false,
    ...over,
  }
}

const PENDING: DomainsState = {
  domains: [
    {
      id: 1,
      domain: 'example.com',
      status: 'pending',
      is_primary: true,
      dns_records: [{ type: 'A', name: '@', value: '203.0.113.7' }],
      checked: true,
      found_ips: ['198.51.100.1'],
      expected_ips: ['203.0.113.7'],
    },
  ],
}

class FakeApi extends NetrunApi {
  added: string[] = []
  verified = 0
  envState: Awaited<ReturnType<NetrunApi['envFiles']>> = { files: [] }
  envThrows = false

  constructor() {
    super(cfg, (async () => new Response('{}')) as unknown as typeof fetch)
  }
  override async getProject() {
    return project()
  }
  override async eventsHistory() {
    return []
  }
  override async listDomains() {
    return PENDING
  }
  override async addDomain(_id: number, domain: string) {
    this.added.push(domain)
    return PENDING
  }
  override async verifyDomains() {
    this.verified += 1
    return {
      domains: [{ ...PENDING.domains[0], status: 'verified' as const, checked: true }],
    }
  }
  override async envFiles() {
    if (this.envThrows) throw new Error('boom')
    return this.envState
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

describe('netrun_domains', () => {
  it('hands the DNS records over and tells the agent not to poll', async () => {
    const client = await connect(new FakeApi())
    const res = payload(await client.callTool({ name: 'netrun_domains', arguments: { project_id: 7 } }))
    const domains = res.domains as Record<string, unknown>[]
    expect(domains[0].domain).toBe('example.com')
    expect(domains[0].dns_records).toEqual([{ type: 'A', name: '@', value: '203.0.113.7' }])
    // «Куда смотрит сейчас» против «куда должен» — единственный ответ на
    // «я всё вписал, почему не работает».
    expect(domains[0].points_at_now).toEqual(['198.51.100.1'])
    expect(String(res.next)).toContain('Do not poll in a loop')
  })

  it('attaches a domain and refuses an empty one with a way out', async () => {
    const api = new FakeApi()
    const client = await connect(api)
    await client.callTool({
      name: 'netrun_domains',
      arguments: { project_id: 7, action: 'add', domain: ' example.com ' },
    })
    expect(api.added).toEqual(['example.com'])

    const bad = await client.callTool({ name: 'netrun_domains', arguments: { project_id: 7, action: 'add' } })
    expect(bad.isError).toBe(true)
    expect(payload(bad).error).toBe('no_domain')
    expect(String(payload(bad).message)).toContain('Ask the user')
  })

  it('checks DNS once per call and says when everything works', async () => {
    const api = new FakeApi()
    const client = await connect(api)
    const res = payload(await client.callTool({ name: 'netrun_domains', arguments: { project_id: 7, action: 'check' } }))
    // Проверка пакетная: один вызов = одна пересборка контейнера.
    expect(api.verified).toBe(1)
    expect(String(res.next)).toContain('working')
  })

  it('has no way to detach a domain — that stays with the human', async () => {
    const client = await connect(new FakeApi())
    const spec = (await client.listTools()).tools.find((t) => t.name === 'netrun_domains')!
    const actions = (spec.inputSchema.properties as Record<string, { enum?: string[] }>).action.enum
    expect(actions).toEqual(['list', 'add', 'check'])
  })
})

describe('netrun_status secrets', () => {
  it('shows the NAMES of the saved secrets and never the values', async () => {
    const api = new FakeApi()
    api.envState = { files: [{ name: '.env', keys: ['BOT_TOKEN', 'ADMIN_ID'], readable: true }] }
    const client = await connect(api)
    const res = payload(await client.callTool({ name: 'netrun_status', arguments: { project_id: 7 } }))
    const secrets = res.secrets as { files: Record<string, unknown>[] }
    expect(secrets.files[0]).toEqual({ file: '.env', keys: ['BOT_TOKEN', 'ADMIN_ID'] })
    expect(JSON.stringify(res)).not.toContain('123:abc')
  })

  it('tells the agent to ask the user when nothing is saved yet', async () => {
    const client = await connect(new FakeApi())
    const res = payload(await client.callTool({ name: 'netrun_status', arguments: { project_id: 7 } }))
    const secrets = res.secrets as { note?: string }
    expect(String(secrets.note)).toContain('ask the user')
  })

  it('does not send the agent to ask for tokens when a .env came with the code', async () => {
    // Платформа такой файл не хранит, но применяет как есть: «секретов нет»
    // здесь было бы неправдой, и агент переспросил бы уже отданный токен.
    const api = new FakeApi()
    api.envState = { files: [], code_files: ['.env'] }
    const client = await connect(api)
    const res = payload(await client.callTool({ name: 'netrun_status', arguments: { project_id: 7 } }))
    const secrets = res.secrets as { in_code?: string[]; note?: string }
    expect(secrets.in_code).toEqual(['.env'])
    expect(String(secrets.note)).toContain('came with the code')
    expect(String(secrets.note)).not.toContain('No secrets saved yet')
  })

  it('marks a file that cannot be read back instead of pretending it is empty', async () => {
    const api = new FakeApi()
    api.envState = { files: [{ name: '.env', keys: [], readable: false }] }
    const client = await connect(api)
    const res = payload(await client.callTool({ name: 'netrun_status', arguments: { project_id: 7 } }))
    const secrets = res.secrets as { files: Record<string, unknown>[] }
    expect(String(secrets.files[0].note)).toContain('cannot be read back')
  })

  it('still answers "how is the project" when the secrets cannot be read', async () => {
    const api = new FakeApi()
    api.envThrows = true
    const client = await connect(api)
    const res = await client.callTool({ name: 'netrun_status', arguments: { project_id: 7 } })
    // Секреты — справка, а не суть ответа: их сбой не роняет статус.
    expect(res.isError).toBeFalsy()
    expect(payload(res).status).toBe('running')
  })
})
