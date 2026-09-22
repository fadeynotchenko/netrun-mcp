#!/usr/bin/env node
/**
 * Точка входа `npx netrun-mcp`: MCP-сервер по stdio.
 *
 * Без NETRUN_API_KEY сервер всё равно поднимается — каждый инструмент тогда
 * отвечает инструкцией, где взять ключ. Так агент объясняет человеку, что
 * делать, вместо молчаливого падения процесса при старте редактора.
 */

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'

import { NetrunApi } from './api.js'
import { editorSetupUrl, readConfig } from './config.js'
import { createServer } from './server.js'

async function main(): Promise<void> {
  const cfg = readConfig()
  if (!cfg.apiKey) {
    // stderr — единственный канал, который MCP-клиенты показывают человеку
    // в логах сервера; stdout занят протоколом.
    process.stderr.write(
      `[netrun-mcp] NETRUN_API_KEY is not set. Create a key at ${editorSetupUrl(cfg)} and add it to the MCP server config.\n`,
    )
  }
  const api = new NetrunApi(cfg)
  const server = createServer(api, cfg)
  const transport = new StdioServerTransport()
  await server.connect(transport)
}

main().catch((err) => {
  process.stderr.write(`[netrun-mcp] fatal: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`)
  process.exit(1)
})
