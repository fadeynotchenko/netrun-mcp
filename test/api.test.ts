import { describe, expect, it, vi } from 'vitest'

import { ApiError, NetrunApi, NotConfiguredError, parseSseLines } from '../src/api.js'
import type { Config } from '../src/config.js'

const cfg: Config = {
  apiKey: 'nru_test',
  apiUrl: 'https://api.test/v1',
  appUrl: 'https://app.test',
  clientName: 'mcp/test',
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

describe('NetrunApi', () => {
  it('exchanges the key once, sends the JWT and the client header afterwards', async () => {
    const calls: { url: string; headers: Record<string, string> }[] = []
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      calls.push({ url, headers: init?.headers as Record<string, string> })
      if (url.endsWith('/api-keys/exchange')) {
        return jsonResponse(200, { access_token: 'jwt-1', expires_in: 900, email: 'u@netrun.io' })
      }
      return jsonResponse(200, [])
    })
    const api = new NetrunApi(cfg, fetchImpl as unknown as typeof fetch)
    await api.listProjects()
    await api.listProjects()

    const exchanges = calls.filter((c) => c.url.endsWith('/api-keys/exchange'))
    expect(exchanges).toHaveLength(1)
    expect(exchanges[0].headers.Authorization).toBe('Bearer nru_test')
    const lists = calls.filter((c) => c.url.endsWith('/projects'))
    expect(lists).toHaveLength(2)
    expect(lists[0].headers.Authorization).toBe('Bearer jwt-1')
    expect(lists[0].headers['X-Netrun-Client']).toBe('mcp/test')
    expect(api.email).toBe('u@netrun.io')
  })

  it('re-exchanges once on 401 and surfaces structured errors', async () => {
    let tokenSeq = 0
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const auth = (init?.headers as Record<string, string>).Authorization
      if (url.endsWith('/api-keys/exchange')) {
        tokenSeq += 1
        return jsonResponse(200, { access_token: `jwt-${tokenSeq}`, expires_in: 900, email: 'u@netrun.io' })
      }
      if (auth === 'Bearer jwt-1') return jsonResponse(401, { detail: 'expired' })
      if (url.endsWith('/projects/7')) {
        return jsonResponse(403, { detail: { code: 'interactive_required', message: 'only in dashboard' } })
      }
      return jsonResponse(200, { id: 1 })
    })
    const api = new NetrunApi(cfg, fetchImpl as unknown as typeof fetch)
    await api.getProject(1)
    expect(tokenSeq).toBe(2)

    const err = await api.getProject(7).catch((e) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect((err as ApiError).code).toBe('interactive_required')
    expect((err as ApiError).status).toBe(403)
  })

  it('explains a missing key instead of calling the network', async () => {
    const fetchImpl = vi.fn()
    const api = new NetrunApi({ ...cfg, apiKey: null }, fetchImpl as unknown as typeof fetch)
    await expect(api.listProjects()).rejects.toBeInstanceOf(NotConfiguredError)
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})

describe('parseSseLines', () => {
  it('turns the SSE snapshot into plain lines and drops the eof frame', () => {
    const raw = 'data: {"line": "starting bot"}\n\ndata: {"line": "ok"}\n\ndata: {"eof": true}\n\n'
    expect(parseSseLines(raw)).toEqual(['starting bot', 'ok'])
  })
})
