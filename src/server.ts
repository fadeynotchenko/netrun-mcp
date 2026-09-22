/**
 * MCP-сервер Netrun: набор действий, которые ИИ-агент (Cursor, Claude Code,
 * Codex, …) зовёт от имени человека. Каждое действие — тонкий перевод в
 * вызов пользовательского API; вся сборка и запуск остаются на платформе.
 *
 * Чего агенту НЕ даём намеренно: удалять проекты и платить. Это делает
 * человек в кабинете; сервер отвечает ссылкой, куда идти.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

import { ApiError, NetrunApi, NotConfiguredError, type Preflight, type Project } from './api.js'
import { bundleFolder, BundleError } from './bundle.js'
import { VERSION, editorSetupUrl, type Config } from './config.js'
import {
  IN_PROGRESS,
  checkoutUrl,
  dashboardUrl,
  describeProject,
  describeTariff,
  humanBytes,
  lastFailure,
  toDotenv,
} from './format.js'

const INSTRUCTIONS = `Netrun hosts websites and bots (Telegram, Discord, …) for people who do not want to manage servers.

Typical flow:
1. To put a project online call netrun_publish with the absolute path of the project folder. For a brand-new project pass a name; to update an existing one pass project_id (find it with netrun_list_projects).
2. If netrun_publish answers with needs_secrets, ASK THE USER for the values (for example the Telegram bot token from @BotFather) and call netrun_publish again with them in "secrets". Never invent or guess secret values.
3. When the result says status "running", tell the user the public URL (websites) or that the bot is live (bots). If it says "failed", read "failure" and fix the code, then publish again.
4. netrun_status and netrun_logs answer "is it working?" and "why not?".

Rules of the platform the agent must respect:
- Free plan: websites sleep when idle and wake on the first visit; bots and scripts get a limited amount of free running time per account, after which they stop until the user switches to Pro. Paying, renewing and deleting projects can only be done by the human in the Netrun dashboard — give them the link from the tool result instead of trying to work around it.
- Do not call netrun_publish in a loop: one publish per code change. Builds take 1–5 minutes.`

const SECRETS_SCHEMA = z
  .record(z.string().regex(/^[A-Za-z0-9_]+$/, 'env variable names: letters, digits, underscore'), z.string())
  .describe('Secrets as {"BOT_TOKEN": "123:abc"}. Stored encrypted; delivered to the app as environment variables via .env. Ask the user for values — never invent them.')

export function createServer(api: NetrunApi, cfg: Config): McpServer {
  const server = new McpServer({ name: 'netrun', version: VERSION }, { instructions: INSTRUCTIONS })
  const links = { appUrl: cfg.appUrl }

  const ok = (payload: unknown) => ({
    content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }],
  })
  const fail = (payload: unknown) => ({
    content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }],
    isError: true,
  })

  /** Единая обработка ошибок: код платформы → что агенту сказать человеку. */
  const guarded =
    <A>(fn: (args: A) => Promise<unknown>) =>
    async (args: A) => {
      try {
        return ok(await fn(args))
      } catch (err) {
        return fail(explainError(err, cfg))
      }
    }

  server.registerTool(
    'netrun_whoami',
    {
      title: 'Netrun account',
      description:
        'Who the configured key belongs to, the current plan, project limit and — on the Free plan — how much free running time bots have left. Call it first when the user asks anything about their Netrun account or limits.',
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    guarded(async () => {
      const [me, tariff, projects] = await Promise.all([api.me(), api.tariff(), api.listProjects()])
      return {
        email: me.email,
        dashboard: `${cfg.appUrl}/projects`,
        projects_used: projects.length,
        ...describeTariff(tariff, links),
      }
    }),
  )

  server.registerTool(
    'netrun_list_projects',
    {
      title: 'List Netrun projects',
      description: 'All projects of the account with id, kind, status and public URL. Use it to find project_id for other tools.',
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    guarded(async () => {
      const projects = await api.listProjects()
      return { count: projects.length, projects: projects.map((p) => describeProject(p, links)) }
    }),
  )

  server.registerTool(
    'netrun_status',
    {
      title: 'Project status',
      description:
        'Current state of one project: is it running, its URL, what blocks it, and — if the last publish failed — why (stage, reason, stderr tail).',
      inputSchema: { project_id: z.number().int().positive() },
      annotations: { readOnlyHint: true },
    },
    guarded(async ({ project_id }) => {
      const project = await api.getProject(project_id)
      const out = describeProject(project, links)
      if (project.status === 'failed') {
        out.failure = lastFailure(await api.eventsHistory(project_id))
      }
      return out
    }),
  )

  server.registerTool(
    'netrun_logs',
    {
      title: 'Project logs',
      description: 'Last lines of the application output (stdout/stderr) — the first place to look when a bot is silent or a site errors.',
      inputSchema: {
        project_id: z.number().int().positive(),
        lines: z.number().int().min(10).max(1000).default(150).describe('How many trailing lines to return'),
      },
      annotations: { readOnlyHint: true },
    },
    guarded(async ({ project_id, lines }) => {
      const rows = await api.logs(project_id, lines)
      return { project_id, lines: rows.length, log: rows.join('\n') }
    }),
  )

  server.registerTool(
    'netrun_publish',
    {
      title: 'Publish to Netrun',
      description:
        'Upload a project folder and put it online: creates a new project (pass name) or ships a new version of an existing one (pass project_id). ' +
        'Detects the language automatically (Python, Node, Go, Rust, PHP, static HTML, Docker, docker-compose…). ' +
        'Waits for the build and returns the public URL or the failure reason. If it returns needs_secrets, ask the user for the values and call again with "secrets".',
      inputSchema: {
        path: z.string().min(1).describe('Absolute path to the project folder on this machine'),
        name: z
          .string()
          .regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/, 'latin letters, digits, - and _; must start with a letter or digit')
          .optional()
          .describe('Name for a NEW project (becomes part of the URL). Omit when updating an existing project.'),
        project_id: z.number().int().positive().optional().describe('Existing project to update. Omit to create a new one.'),
        secrets: SECRETS_SCHEMA.optional(),
        skip_secrets: z
          .boolean()
          .default(false)
          .describe('Publish even though the code seems to read env variables that were not provided. Use only after the user confirmed the app does not need them.'),
        comment: z.string().max(200).optional().describe('Short note for the version history, e.g. "fix /start handler"'),
        wait: z.boolean().default(true).describe('Wait for the build to finish (up to wait_seconds). false = return right after upload.'),
        wait_seconds: z.number().int().min(10).max(600).default(300),
      },
      annotations: { destructiveHint: false, idempotentHint: false },
    },
    guarded(async (args) => publish(api, cfg, args)),
  )

  server.registerTool(
    'netrun_set_secrets',
    {
      title: 'Set project secrets',
      description:
        'Save environment variables (tokens, API keys, passwords) for a project. Values are stored encrypted and never returned. ' +
        'By default the project is re-published so the app picks them up. Ask the user for the values — do not invent them.',
      inputSchema: {
        project_id: z.number().int().positive(),
        secrets: SECRETS_SCHEMA,
        file: z.string().default('.env').describe('Which env file to write to; ".env" unless the project uses another'),
        publish: z.boolean().default(true).describe('Re-publish right away so the running app receives the new values'),
      },
      annotations: { destructiveHint: false },
    },
    guarded(async ({ project_id, secrets, file, publish: republish }) => {
      const project = await api.setEnvKeys(project_id, file, secrets, republish)
      return {
        saved_keys: Object.keys(secrets),
        file,
        published: republish,
        project: describeProject(project, links),
        next: republish
          ? 'The app is being re-published; check netrun_status in a minute.'
          : 'Saved but not applied yet — call netrun_publish or netrun_set_secrets with publish=true to apply.',
      }
    }),
  )

  server.registerTool(
    'netrun_control',
    {
      title: 'Start / stop / restart',
      description: 'Start, stop or restart a project. Stopping a Free-plan bot does not pause its free running time.',
      inputSchema: {
        project_id: z.number().int().positive(),
        action: z.enum(['start', 'stop', 'restart']),
      },
      annotations: { destructiveHint: false },
    },
    guarded(async ({ project_id, action }) => {
      const project = await api.control(project_id, action)
      return { action, project: describeProject(project, links) }
    }),
  )

  return server
}

// ── Публикация ─────────────────────────────────────────────────────────

type PublishArgs = {
  path: string
  name?: string
  project_id?: number
  secrets?: Record<string, string>
  skip_secrets: boolean
  comment?: string
  wait: boolean
  wait_seconds: number
}

async function publish(api: NetrunApi, cfg: Config, args: PublishArgs): Promise<unknown> {
  const links = { appUrl: cfg.appUrl }
  const bundle = await bundleFolder(args.path)
  const upload = {
    files: bundle.files,
    size: humanBytes(bundle.bytes),
    top_level: bundle.topLevel,
    skipped: bundle.skipped.slice(0, 20),
  }

  let project: Project
  if (args.project_id) {
    // Обновление: секреты (если дали) доливаются к уже сохранённым —
    // на сервере это слияние, а не замена.
    const envFiles = args.secrets && Object.keys(args.secrets).length ? { '.env': toDotenv(args.secrets) } : undefined
    project = await api.updateCode(args.project_id, bundle.zip, { comment: args.comment, envFiles })
  } else {
    const name = args.name ?? defaultName(args.path)
    const check = await api.checkName(name)
    if (!check.available) {
      return {
        error: check.reason === 'taken' ? 'name_taken' : 'invalid_name',
        message:
          check.reason === 'taken'
            ? `The name "${name}" is already taken on Netrun. Pick another name and call netrun_publish again.`
            : `The name "${name}" is not allowed: use latin letters, digits, "-" or "_", starting with a letter or digit.`,
      }
    }
    const pre = await api.preflight(bundle.zip)
    const missing = missingSecrets(pre, args.secrets)
    const gaveSecrets = Boolean(args.secrets && Object.keys(args.secrets).length)
    if (missing.required.length) {
      return {
        needs_secrets: true,
        message:
          'Before the first publish the project needs these secrets. Ask the user for the values ' +
          '(for a Telegram bot the token comes from @BotFather), then call netrun_publish again with them in "secrets". ' +
          'Do not invent values.',
        required: missing.required,
        optional: missing.optional,
        upload,
      }
    }
    // Ключи, вычитанные из самого кода (`os.getenv("BOT_TOKEN")`), платформа
    // считает необязательными — кабинет не имеет права держать кнопку из-за
    // догадки. Агенту спросить человека дёшево, а бот без токена уйдёт в
    // петлю перезапусков и потребует второй сборки — поэтому спрашиваем,
    // но даём обойти явным skip_secrets.
    if (missing.optional.length && !gaveSecrets && !args.skip_secrets) {
      return {
        needs_secrets: true,
        can_skip: true,
        message:
          'The code reads these environment variables, but no values were provided. Ask the user for them and call ' +
          'netrun_publish again with "secrets". If the user says the app works without them, call again with skip_secrets=true.',
        required: [],
        optional: missing.optional,
        upload,
      }
    }
    const envFiles = buildEnvFiles(pre, args.secrets)
    const composeFile = pre.layout === 'compose' && pre.compose_files.length === 1 ? pre.compose_files[0] : undefined
    project = await api.createProject({ name, preflightId: pre.preflight_id, envFiles, composeFile })
    if (missing.optional.length) {
      ;(upload as Record<string, unknown>).secrets_not_set = missing.optional
    }
  }

  if (!args.wait) {
    return {
      accepted: true,
      upload,
      project: describeProject(project, links),
      next: 'Build started. Call netrun_status with this project_id in a minute or two.',
    }
  }

  const final = await waitForDeploy(api, project.id, args.wait_seconds)
  const out: Record<string, unknown> = { upload, project: describeProject(final, links) }
  if (IN_PROGRESS.has(final.status)) {
    out.still_building = true
    out.next = `The build is still running after ${args.wait_seconds}s (large projects take longer). Call netrun_status later — do not publish again.`
  } else if (final.status === 'failed') {
    out.failure = lastFailure(await api.eventsHistory(project.id))
    out.next =
      'Fix the cause and call netrun_publish again with the same project_id. If the reason is a missing secret, use netrun_set_secrets instead.'
  } else if (final.status === 'running' || final.status === 'sleeping') {
    out.next =
      final.app_kind === 'web'
        ? `The site is live at ${final.host_url}. Tell the user the link.`
        : 'The bot is running — tell the user to message it. Free plan: it will stop when the free running time ends.'
  } else if (final.status === 'stopped') {
    out.next = final.app_kind === 'script'
      ? 'The script ran and finished (exit code 0). For always-running processes make the program loop or wait.'
      : 'The app exited on its own. Read netrun_logs to see why.'
  }
  return out
}

function defaultName(folder: string): string {
  const base = folder.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? 'app'
  const cleaned = base.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^[-_]+/, '').slice(0, 64)
  return cleaned || 'app'
}

function missingSecrets(
  pre: Preflight,
  given: Record<string, string> | undefined,
): { required: { file: string; keys: string[] }[]; optional: { file: string; keys: string[] }[] } {
  const haveKeys = new Set(Object.keys(given ?? {}))
  const optionalFiles = new Set(pre.optional_env_files ?? [])
  const required: { file: string; keys: string[] }[] = []
  const optional: { file: string; keys: string[] }[] = []
  for (const file of pre.missing_env_files ?? []) {
    const template = pre.env_templates_kv?.[file] ?? {}
    const keys = Object.keys(template).filter((k) => !haveKeys.has(k))
    // Секреты даны, а ключей-подсказок у платформы нет — считаем, что
    // человек знает свой .env лучше нас: файл соберём из того, что дали.
    if (given && Object.keys(given).length && keys.length === 0) continue
    const entry = { file, keys: keys.length ? keys : ['(unknown keys — check the code for os.getenv / process.env)'] }
    if (optionalFiles.has(file)) optional.push(entry)
    else required.push(entry)
  }
  return { required, optional }
}

function buildEnvFiles(pre: Preflight, given: Record<string, string> | undefined): Record<string, string> | undefined {
  if (!given || !Object.keys(given).length) return undefined
  // Один `.env` на всё: и loose-ключи compose, и переменные из кода
  // платформа складывает туда же (см. PreflightUseCase).
  const target = (pre.missing_env_files ?? []).find((f) => f === '.env') ?? pre.missing_env_files?.[0] ?? '.env'
  return { [target]: toDotenv(given) }
}

async function waitForDeploy(api: NetrunApi, id: number, seconds: number): Promise<Project> {
  const deadline = Date.now() + seconds * 1000
  let project = await api.getProject(id)
  while (IN_PROGRESS.has(project.status) && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 3000))
    project = await api.getProject(id)
  }
  return project
}

// ── Ошибки → объяснение для агента ─────────────────────────────────────

export function explainError(err: unknown, cfg: Config): Record<string, unknown> {
  if (err instanceof NotConfiguredError) {
    return { error: 'not_configured', message: err.message, setup: editorSetupUrl(cfg) }
  }
  if (err instanceof BundleError) {
    return { error: 'bundle', message: err.message }
  }
  if (err instanceof ApiError) {
    const base: Record<string, unknown> = { error: err.code ?? `http_${err.status}`, message: err.message }
    switch (err.code) {
      case 'interactive_required':
        base.message = 'This action can only be done by the human in the Netrun dashboard, not through the editor connection.'
        base.dashboard = `${cfg.appUrl}/projects`
        break
      case 'limit_exceeded':
        base.message =
          'The account has reached its project limit on the current plan. Either update an existing project (pass project_id) or ask the user to add a place / switch plan.'
        base.upgrade = checkoutUrl({ appUrl: cfg.appUrl }, 'agent_limit')
        break
      case 'bot_free_time_used':
        base.message =
          'This bot already used its free running time on another Netrun account. On the Free plan it cannot be published again; Pro runs it around the clock.'
        base.upgrade = checkoutUrl({ appUrl: cfg.appUrl }, 'agent_bot_reuse')
        break
      case 'invalid_api_key':
        base.message =
          'The Netrun key in NETRUN_API_KEY is not valid or was revoked. Ask the user to create a new key and update the MCP config.'
        base.setup = editorSetupUrl(cfg)
        break
      default:
        if (err.status === 401) {
          base.message = 'Netrun rejected the key. Ask the user to create a new one.'
          base.setup = editorSetupUrl(cfg)
        }
    }
    if (err.detail && typeof err.detail === 'object') base.detail = err.detail
    return base
  }
  const message = err instanceof Error ? err.message : String(err)
  return { error: 'unexpected', message }
}

export { dashboardUrl }
