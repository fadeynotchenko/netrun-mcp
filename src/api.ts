/**
 * Тонкий HTTP-клиент к пользовательскому API Netrun.
 *
 * Ключ `nru_…` в запросы к проектам не ходит: один раз меняется на обычный
 * 15-минутный access-токен (`POST /api-keys/exchange`), который дальше и
 * используется. Протух — обменяем заново, прозрачно для инструмента.
 */

import type { Config } from './config.js'

export class ApiError extends Error {
  status: number
  code: string | null
  detail: unknown

  constructor(status: number, message: string, code: string | null, detail: unknown) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.detail = detail
  }
}

/** Ошибка настройки: ключ не задан. Отдельный класс — инструмент даёт человеку инструкцию, а не стек. */
export class NotConfiguredError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'NotConfiguredError'
  }
}

type Json = Record<string, unknown>

export type Project = {
  id: number
  name: string
  slug: string
  status: string
  runtime: string
  app_kind: 'web' | 'bot' | 'script' | string
  host_url: string | null
  last_error: string | null
  files_count: number
  updated_at: string
  is_blocked: boolean
  admin_blocked: boolean
  admin_block_reason?: string | null
  disk_blocked: boolean
  disk_blocked_reason?: string | null
  trial_stopped: boolean
  crash_looping?: boolean
  restarts_recent?: number
  custom_domain?: string | null
  custom_domain_status?: string
  pending_publish?: boolean
  layout?: string
  primary_service?: string | null
}

export type Preflight = {
  preflight_id: string
  layout: string
  compose_files: string[]
  missing_env_files: string[]
  optional_env_files: string[]
  env_templates: Record<string, string>
  env_templates_kv?: Record<string, Record<string, string>>
  warnings: string[]
}

export type ProjectEvent = {
  id: number
  kind: 'step' | 'log' | 'status'
  step: string | null
  state: 'running' | 'done' | 'failed' | null
  message: string
  meta: Record<string, unknown>
  created_at: string
}

export type Tariff = {
  slug: string
  name: string
  limits: { metric: string; value: number | null; unit: string }[]
  renews_at: string | null
  nonweb_trial?: { seconds_total: number; expires_at: string | null; exhausted: boolean } | null
  extra_slots: number
  follow_slots: number
  tier_prices: { tier_slug?: string; period: string; amount_minor: number; days?: number; sellable?: boolean }[]
}

export type Me = { id: number; email: string; tier: string; is_admin?: boolean }

type RequestOptions = {
  method?: string
  json?: Json
  form?: FormData
  query?: Record<string, string | number | boolean | undefined>
  headers?: Record<string, string>
  /** Не обменивать ключ и не слать токен (сам обмен). */
  anonymous?: boolean
  /** Вернуть текст, а не JSON (SSE-снимок логов). */
  text?: boolean
}

// Обмениваем заранее, за минуту до конца жизни токена: у долгой сборки
// не должно быть шанса упереться в 401 посреди опроса статуса.
const TOKEN_SAFETY_MS = 60_000

export class NetrunApi {
  private readonly cfg: Config
  private readonly fetchImpl: typeof fetch
  private token: { value: string; expiresAt: number; email: string } | null = null

  constructor(cfg: Config, fetchImpl: typeof fetch = fetch) {
    this.cfg = cfg
    this.fetchImpl = fetchImpl
  }

  get appUrl(): string {
    return this.cfg.appUrl
  }

  /** Почта владельца ключа — известна после первого обмена. */
  get email(): string | null {
    return this.token?.email ?? null
  }

  private async accessToken(force = false): Promise<string> {
    if (!this.cfg.apiKey) {
      throw new NotConfiguredError(
        'NETRUN_API_KEY is not set. Ask the user to create a key at ' +
          `${this.cfg.appUrl}/mcp and put it into the MCP server config as NETRUN_API_KEY.`,
      )
    }
    const now = Date.now()
    if (!force && this.token && this.token.expiresAt - TOKEN_SAFETY_MS > now) {
      return this.token.value
    }
    const body = (await this.request<{ access_token: string; expires_in: number; email: string }>(
      '/api-keys/exchange',
      { method: 'POST', anonymous: true, headers: { Authorization: `Bearer ${this.cfg.apiKey}` } },
    )) as { access_token: string; expires_in: number; email: string }
    this.token = {
      value: body.access_token,
      expiresAt: now + body.expires_in * 1000,
      email: body.email,
    }
    return body.access_token
  }

  async request<T = unknown>(path: string, opts: RequestOptions = {}): Promise<T | string> {
    const url = new URL(this.cfg.apiUrl + path)
    for (const [k, v] of Object.entries(opts.query ?? {})) {
      if (v !== undefined) url.searchParams.set(k, String(v))
    }
    const doFetch = async (retry: boolean): Promise<Response> => {
      const headers: Record<string, string> = {
        Accept: opts.text ? 'text/event-stream, text/plain, */*' : 'application/json',
        'X-Netrun-Client': this.cfg.clientName,
        'X-Lang': 'en',
        ...(opts.headers ?? {}),
      }
      if (!opts.anonymous) {
        headers.Authorization = `Bearer ${await this.accessToken(retry)}`
      }
      let body: BodyInit | undefined
      if (opts.json !== undefined) {
        headers['Content-Type'] = 'application/json'
        body = JSON.stringify(opts.json)
      } else if (opts.form) {
        body = opts.form
      }
      return this.fetchImpl(url, { method: opts.method ?? (body ? 'POST' : 'GET'), headers, body })
    }

    let res = await doFetch(false)
    // Токен мог протухнуть или быть отозван вместе с ключом: один повтор
    // со свежим обменом — и только для авторизованных запросов.
    if (res.status === 401 && !opts.anonymous) {
      res = await doFetch(true)
    }
    if (!res.ok) {
      throw await this.toError(res)
    }
    if (res.status === 204) return '' as T
    if (opts.text) return await res.text()
    return (await res.json()) as T
  }

  private async toError(res: Response): Promise<ApiError> {
    let detail: unknown = null
    let message = `${res.status} ${res.statusText}`.trim()
    let code: string | null = null
    try {
      const parsed = (await res.json()) as { detail?: unknown }
      detail = parsed.detail ?? parsed
      if (typeof detail === 'string') {
        message = detail
      } else if (detail && typeof detail === 'object') {
        const d = detail as { code?: string; message?: string }
        if (typeof d.message === 'string') message = d.message
        if (typeof d.code === 'string') code = d.code
      }
    } catch {
      // тело не JSON — оставляем статус
    }
    return new ApiError(res.status, message, code, detail)
  }

  // ── Аккаунт ──────────────────────────────────────────────────────────

  async me(): Promise<Me> {
    return (await this.request<Me>('/auth/me')) as Me
  }

  async tariff(): Promise<Tariff> {
    return (await this.request<Tariff>('/billing/tariff')) as Tariff
  }

  // ── Проекты ──────────────────────────────────────────────────────────

  async listProjects(): Promise<Project[]> {
    return (await this.request<Project[]>('/projects')) as Project[]
  }

  async getProject(id: number): Promise<Project> {
    return (await this.request<Project>(`/projects/${id}`)) as Project
  }

  async checkName(name: string): Promise<{ available: boolean; slug: string; reason: string | null }> {
    return (await this.request('/projects/check-name', { json: { name } })) as {
      available: boolean
      slug: string
      reason: string | null
    }
  }

  async preflight(zip: Uint8Array): Promise<Preflight> {
    const form = new FormData()
    form.set('source_kind', 'archive')
    form.append('files', zipBlob(zip), 'project.zip')
    return (await this.request<Preflight>('/projects/preflight', { form })) as Preflight
  }

  async createProject(input: {
    name: string
    preflightId: string
    envFiles?: Record<string, string>
    composeFile?: string
    primaryService?: string
  }): Promise<Project> {
    const form = new FormData()
    form.set('name', input.name)
    form.set('source_kind', 'archive')
    form.set('preflight_id', input.preflightId)
    if (input.envFiles && Object.keys(input.envFiles).length) {
      form.set('env_files_json', JSON.stringify(input.envFiles))
    }
    if (input.composeFile) form.set('compose_file', input.composeFile)
    if (input.primaryService) form.set('primary_service', input.primaryService)
    return (await this.request<Project>('/projects', { form })) as Project
  }

  async updateCode(
    id: number,
    zip: Uint8Array,
    input: { comment?: string; envFiles?: Record<string, string> } = {},
  ): Promise<Project> {
    const form = new FormData()
    form.set('source_kind', 'archive')
    form.append('files', zipBlob(zip), 'project.zip')
    if (input.comment) form.set('comment', input.comment)
    if (input.envFiles && Object.keys(input.envFiles).length) {
      form.set('env_files_json', JSON.stringify(input.envFiles))
    }
    return (await this.request<Project>(`/projects/${id}/code`, { form })) as Project
  }

  async setEnvKeys(
    id: number,
    file: string,
    keys: Record<string, string>,
    redeploy: boolean,
  ): Promise<Project> {
    return (await this.request<Project>(`/projects/${id}/env-files`, {
      method: 'PUT',
      json: { set_keys: { [file]: keys }, redeploy },
    })) as Project
  }

  async envFiles(id: number): Promise<{ files: { name: string; keys: string[]; readable: boolean }[] }> {
    return (await this.request(`/projects/${id}/env-files`)) as {
      files: { name: string; keys: string[]; readable: boolean }[]
    }
  }

  async control(id: number, action: 'start' | 'stop' | 'restart'): Promise<Project> {
    return (await this.request<Project>(`/projects/${id}/${action}`, { method: 'POST' })) as Project
  }

  async eventsHistory(id: number): Promise<ProjectEvent[]> {
    return (await this.request<ProjectEvent[]>(`/projects/${id}/events/history`)) as ProjectEvent[]
  }

  /** Снимок последних строк логов: SSE-кадры `data: {"line": …}` → строки. */
  async logs(id: number, tail: number): Promise<string[]> {
    const raw = (await this.request<string>(`/projects/${id}/logs`, {
      query: { follow: false, tail },
      text: true,
    })) as string
    return parseSseLines(raw)
  }
}

/** Uint8Array → Blob без спора типов про SharedArrayBuffer (копия байт). */
function zipBlob(zip: Uint8Array): Blob {
  const copy = new Uint8Array(zip.byteLength)
  copy.set(zip)
  return new Blob([copy.buffer as ArrayBuffer], { type: 'application/zip' })
}

export function parseSseLines(raw: string): string[] {
  const lines: string[] = []
  for (const frame of raw.split(/\n\n+/)) {
    for (const row of frame.split('\n')) {
      if (!row.startsWith('data:')) continue
      const payload = row.slice(5).trim()
      if (!payload) continue
      try {
        const obj = JSON.parse(payload) as { line?: unknown; eof?: boolean }
        if (typeof obj.line === 'string') lines.push(obj.line)
      } catch {
        lines.push(payload)
      }
    }
  }
  return lines
}
