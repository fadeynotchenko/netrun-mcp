/**
 * Настройки клиента — только из окружения: так их задаёт любой MCP-клиент
 * (Cursor, Claude Code, Codex) в своём конфиге сервера.
 *
 *   NETRUN_API_KEY  — личный ключ `nru_…` со страницы «MCP» в кабинете.
 *   NETRUN_API_URL  — база API (по умолчанию прод). Меняется только для дева.
 *   NETRUN_APP_URL  — адрес кабинета для ссылок в ответах агенту.
 */

import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const pkg = require('../package.json') as { version: string }

export const VERSION: string = pkg.version

export type Config = {
  apiKey: string | null
  apiUrl: string
  appUrl: string
  /** Заголовок `X-Netrun-Client` — по нему платформа считает публикации через агента. */
  clientName: string
}

export function readConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const apiKey = (env.NETRUN_API_KEY ?? '').trim() || null
  const apiUrl = (env.NETRUN_API_URL ?? 'https://api.netrun.io/v1').replace(/\/+$/, '')
  const appUrl = (env.NETRUN_APP_URL ?? 'https://netrun.io').replace(/\/+$/, '')
  return { apiKey, apiUrl, appUrl, clientName: `mcp/${VERSION}` }
}

/** Страница кабинета, где человек выпускает ключ. */
export function editorSetupUrl(cfg: Config): string {
  return `${cfg.appUrl}/mcp`
}
