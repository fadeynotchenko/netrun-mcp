/**
 * Перевод ответов платформы на язык, понятный агенту: что со статусом,
 * что человеку делать дальше, куда вести. Всё по-английски — агент
 * пересказывает на языке человека сам.
 */

import type { Project, ProjectDomain, ProjectEvent, Tariff } from './api.js'

export type Links = { appUrl: string }

export function dashboardUrl(links: Links, project: Pick<Project, 'id'>): string {
  return `${links.appUrl}/projects/${project.id}`
}

export function checkoutUrl(links: Links, reason: string): string {
  return `${links.appUrl}/checkout?kind=tariff&reason=${encodeURIComponent(reason)}`
}

const STATUS_HUMAN: Record<string, string> = {
  queued: 'queued for build',
  building: 'building',
  starting: 'starting',
  running: 'running',
  failed: 'failed',
  stopped: 'stopped',
  deleting: 'being deleted',
  unreachable: 'server temporarily unreachable',
  sleeping: 'sleeping (free plan: wakes up on the first visit)',
  waking: 'waking up',
}

export const IN_PROGRESS = new Set(['queued', 'building', 'starting', 'waking'])

export function kindHuman(p: Project): string {
  if (p.app_kind === 'web') return 'website / web app'
  if (p.app_kind === 'bot') return 'bot (Telegram / Discord / …)'
  if (p.app_kind === 'script') return 'background script'
  return String(p.app_kind)
}

/** Что мешает проекту работать и как это лечится. Пусто — всё в порядке. */
export function blockers(p: Project, links: Links): string[] {
  const out: string[] = []
  if (p.trial_stopped) {
    out.push(
      'Stopped: the free running time for bots on the Free plan is over. ' +
        `Only the human can fix this by switching to Pro: ${checkoutUrl(links, 'trial_over')} — ` +
        'after payment the bot starts again automatically.',
    )
  }
  if (p.is_blocked) {
    out.push(
      'Stopped: the paid place for this project has expired. Only the human can renew it in the dashboard: ' +
        `${links.appUrl}/profile/slots`,
    )
  }
  if (p.admin_blocked) {
    out.push(`Blocked by Netrun moderation${p.admin_block_reason ? `: ${p.admin_block_reason}` : ''}. Contact support.`)
  }
  if (p.disk_blocked) {
    out.push(
      `Stopped: the project exceeded its disk budget${p.disk_blocked_reason ? ` (${p.disk_blocked_reason})` : ''}. ` +
        'Free up space in the Data tab or switch to a bigger plan.',
    )
  }
  if (p.crash_looping) {
    out.push(
      `The container starts but the app exits right away (${p.restarts_recent ?? 'many'} restarts in the last hour). ` +
        'Read the logs with netrun_logs — most often a secret like BOT_TOKEN is missing or wrong; set it with netrun_set_secrets.',
    )
  }
  return out
}

export function describeProject(p: Project, links: Links): Record<string, unknown> {
  const out: Record<string, unknown> = {
    id: p.id,
    name: p.name,
    kind: kindHuman(p),
    status: p.status,
    status_human: STATUS_HUMAN[p.status] ?? p.status,
    url: p.host_url,
    dashboard: dashboardUrl(links, p),
    runtime: p.runtime,
    updated_at: p.updated_at,
  }
  if (p.custom_domain && p.custom_domain_status === 'verified') out.custom_domain = `https://${p.custom_domain}`
  // Выбор человека («мне нужна ссылка» / «ссылка не нужна») — чтобы агент
  // не предлагал netrun_link тому, кто уже решил.
  if (p.app_kind_pinned) out.link_choice = p.app_kind_pinned === 'web' ? 'public link requested' : 'no public link'
  if (p.last_error) out.last_error = p.last_error
  if (p.pending_publish) out.note = 'Secrets were changed but not published yet — call netrun_set_secrets with publish=true or netrun_publish.'
  const problems = blockers(p, links)
  if (problems.length) out.problems = problems
  return out
}

/**
 * Чем кончилось «нужна ссылка / не нужна» — то, что агент скажет человеку.
 * Зеркало `link_outcome` в `api/infrastructure/mcp/format.py`: две двери
 * обязаны отвечать одинаково.
 *
 * ⚠️ «Просили ссылку, а тип не web» — не ошибка, а мягкая посадка: приложение
 * не ответило ни на один запрос, платформа оставила его работать в фоне и
 * сняла выбор. Агенту нужно назвать ПРИЧИНУ, иначе он позовёт снова.
 */
export function linkOutcome(p: Project, needed: boolean, waitSeconds: number): Record<string, unknown> {
  const out: Record<string, unknown> = { needed }
  if (IN_PROGRESS.has(p.status)) {
    out.still_building = true
    out.next = `The re-publish is still running after ${waitSeconds}s. Call netrun_status with this project_id later — do NOT call netrun_link again, it would start another build.`
  } else if (p.status === 'failed') {
    out.next = "The re-publish failed — read 'failure', fix the cause and publish again. The choice is kept."
  } else if (needed && p.app_kind === 'web' && p.host_url) {
    out.link = p.host_url
    out.next = `The project now answers at ${p.host_url} over HTTPS. For a webhook bot register this address plus the handler path with the bot platform (Telegram: setWebhook). The choice survives later code updates.`
  } else if (needed) {
    out.link_confirmed = false
    out.next =
      'The app did not answer any request from the internet, so Netrun keeps it running in the background without a link — nothing is lost. ' +
      'To get a link the app must listen on 0.0.0.0 on the port from the PORT environment variable. Fix the code, publish it, then call netrun_link with needed=true again.'
  } else {
    out.next = 'The project runs in the background without a public address.'
  }
  return out
}

/** Причина последнего провала публикации — из ленты событий. */
export function lastFailure(events: ProjectEvent[]): Record<string, unknown> | null {
  const failed = [...events].reverse().find((e) => e.state === 'failed' && e.meta && typeof e.meta === 'object')
  if (!failed) return null
  const m = failed.meta as Record<string, unknown>
  const pick = (k: string): string | undefined => (typeof m[k] === 'string' && (m[k] as string).trim() ? (m[k] as string) : undefined)
  return {
    stage: pick('stage') ?? failed.step ?? undefined,
    reason: pick('short_reason_en') ?? pick('short_reason') ?? failed.message,
    explanation: pick('explanation_en') ?? pick('explanation'),
    // Хвост stderr — самое полезное для агента: там traceback / npm error.
    stderr_tail: pick('stderr_tail'),
    blame: pick('blame'),
    at: failed.created_at,
  }
}

const DOMAIN_STATUS_HUMAN: Record<string, string> = {
  pending: 'waiting for the DNS records to take effect',
  verified: 'working',
  failed: 'the DNS records do not point at us',
}

/**
 * Один свой домен — так, чтобы агент мог ПЕРЕСКАЗАТЬ это человеку.
 * Зеркало `describe_domain` в `api/infrastructure/mcp/format.py`: две
 * двери обязаны отвечать одинаково.
 *
 * ⚠️ DNS-записи отдаём всегда, а не только у непроверенных: пока запись
 * не разошлась, человеку нужно видеть, что вписывать, а после проверки —
 * что у него уже вписано. Агент прошлый ответ не помнит.
 */
export function describeDomain(d: ProjectDomain): Record<string, unknown> {
  const out: Record<string, unknown> = {
    domain: d.domain,
    status: d.status,
    status_human: DOMAIN_STATUS_HUMAN[d.status] ?? d.status,
  }
  if (d.dns_records?.length) {
    out.dns_records = d.dns_records.map((r) => ({ type: r.type, name: r.name, value: r.value }))
  }
  if (d.checked && d.status !== 'verified') {
    out.points_at_now = d.found_ips ?? []
    out.should_point_at = d.expected_ips ?? []
  }
  return out
}

export function describeTariff(t: Tariff, links: Links): Record<string, unknown> {
  const limit = (metric: string) => t.limits.find((l) => l.metric === metric)?.value ?? null
  const out: Record<string, unknown> = {
    plan: t.slug,
    plan_name: t.name,
    paid_until: t.renews_at,
    projects_limit: (limit('projects.active_count') ?? 0) + (t.extra_slots ?? 0),
    memory_mb: limit('memory.per_project_mb'),
    cpu_millis: limit('cpu.per_project_millis'),
    disk_mb: limit('storage.per_project_mb'),
  }
  if (t.slug === 'free') {
    out.free_plan_rules = [
      'Websites sleep after idle time and wake up on the first visit (a few seconds delay).',
      'Bots and scripts cannot sleep, so they get a limited amount of free running time per account; after that they stop until the account switches to Pro.',
    ]
    const trial = t.nonweb_trial
    if (trial) {
      out.bot_free_time = trial.exhausted
        ? { exhausted: true, upgrade: checkoutUrl(links, 'trial_over') }
        : trial.expires_at
          ? { total_seconds: trial.seconds_total, ends_at: trial.expires_at }
          : { total_seconds: trial.seconds_total, started: false }
    }
    const month = t.tier_prices.find((p) => (p.tier_slug ?? 'pro') === 'pro' && p.period === 'monthly')
    if (month) out.pro_price_monthly_usd = (month.amount_minor / 100).toFixed(2)
    out.upgrade = checkoutUrl(links, 'agent')
  }
  return out
}

/** Секреты `{KEY: value}` → содержимое `.env`. Значения с пробелами берём в кавычки. */
export function toDotenv(keys: Record<string, string>): string {
  return (
    Object.entries(keys)
      .map(([k, v]) => {
        const needsQuotes = /[\s#"'\\$]/.test(v)
        const value = needsQuotes ? `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"` : v
        return `${k}=${value}`
      })
      .join('\n') + '\n'
  )
}

export function humanBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}
