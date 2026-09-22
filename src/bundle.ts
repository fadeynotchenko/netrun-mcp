/**
 * Сборка папки проекта в ZIP для отправки на платформу.
 *
 * Зеркало серверных правил (`archive_extractor._IGNORED_DIR_PREFIXES` +
 * корневой `.gitignore`), чтобы node_modules и сборки не ехали по сети
 * только ради того, чтобы сервер их выбросил. Ошибаться безопасно только в
 * одну сторону: лишний отправленный файл сервер отбросит сам, а лишний
 * отфильтрованный здесь просто не доедет до сборки — поэтому список
 * консервативный и совпадает с серверным.
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'
import { zipSync } from 'fflate'
import ignore from 'ignore'

// Совпадает с `_IGNORED_DIR_PREFIXES` на сервере (archive_extractor.py).
export const IGNORED_DIRS = new Set([
  'node_modules',
  '.pnpm-store',
  'bower_components',
  'vendor',
  '.venv',
  'venv',
  '.tox',
  '__pycache__',
  '.pytest_cache',
  '.mypy_cache',
  '.ruff_cache',
  '.pytype',
  '.next',
  '.nuxt',
  '.svelte-kit',
  '.output',
  '.turbo',
  '.cache',
  '.parcel-cache',
  '.wrangler',
  'target',
  '.gradle',
  '.git',
  '.hg',
  '.svn',
  '.idea',
  '.vscode',
  'coverage',
  '.nyc_output',
  '__MACOSX',
])

// Потолок платформы на дерево проекта (archive_extractor.MAX_TOTAL_BYTES).
export const MAX_TOTAL_BYTES = 100 * 1024 * 1024
export const MAX_FILE_BYTES = 100 * 1024 * 1024
// Файлы-манифесты, которые никогда не фильтруются `.gitignore`: без них
// платформе нечем узнать секреты и правила (та же логика на сервере).
const NEVER_IGNORED = (rel: string): boolean => {
  const base = path.posix.basename(rel)
  return base === '.gitignore' || base === '.env' || base.startsWith('.env.')
}

export type Bundle = {
  zip: Uint8Array
  files: number
  bytes: number
  /** Что отфильтровали по .gitignore / служебным папкам — для честного отчёта агенту. */
  skipped: string[]
  /** Имена файлов верхнего уровня — агенту, чтобы описать, что уехало. */
  topLevel: string[]
}

export class BundleError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BundleError'
  }
}

async function readRootGitignore(root: string): Promise<ReturnType<typeof ignore> | null> {
  try {
    const text = await fs.readFile(path.join(root, '.gitignore'), 'utf8')
    return ignore().add(text)
  } catch {
    return null
  }
}

/** Папка проекта → ZIP. `root` обязан быть существующей директорией. */
export async function bundleFolder(root: string): Promise<Bundle> {
  const abs = path.resolve(root)
  let stat
  try {
    stat = await fs.stat(abs)
  } catch {
    throw new BundleError(`Folder not found: ${abs}`)
  }
  if (!stat.isDirectory()) {
    throw new BundleError(`Not a folder: ${abs}. Pass the project folder, not a file.`)
  }

  const ig = await readRootGitignore(abs)
  const entries: Record<string, Uint8Array> = {}
  const skipped: string[] = []
  const topLevel = new Set<string>()
  let bytes = 0
  let files = 0

  async function walk(dirAbs: string, relDir: string): Promise<void> {
    const dirents = await fs.readdir(dirAbs, { withFileTypes: true })
    dirents.sort((a, b) => a.name.localeCompare(b.name))
    for (const d of dirents) {
      const rel = relDir ? `${relDir}/${d.name}` : d.name
      if (d.isSymbolicLink()) {
        skipped.push(`${rel} (symlink)`)
        continue
      }
      if (d.isDirectory()) {
        if (IGNORED_DIRS.has(d.name)) {
          skipped.push(`${rel}/`)
          continue
        }
        if (ig && ig.ignores(`${rel}/`)) {
          skipped.push(`${rel}/`)
          continue
        }
        await walk(path.join(dirAbs, d.name), rel)
        continue
      }
      if (!d.isFile()) continue
      if (d.name === '.DS_Store') continue
      if (ig && !NEVER_IGNORED(rel) && ig.ignores(rel)) {
        skipped.push(rel)
        continue
      }
      const fileAbs = path.join(dirAbs, d.name)
      const fstat = await fs.stat(fileAbs)
      if (fstat.size > MAX_FILE_BYTES) {
        throw new BundleError(
          `File ${rel} is ${Math.round(fstat.size / 1024 / 1024)} MB — the platform accepts files up to 100 MB. ` +
            'Add it to .gitignore or remove it from the folder.',
        )
      }
      bytes += fstat.size
      if (bytes > MAX_TOTAL_BYTES) {
        throw new BundleError(
          'The project is larger than 100 MB after filtering. Add build outputs, datasets and media to .gitignore ' +
            'and try again.',
        )
      }
      entries[rel] = new Uint8Array(await fs.readFile(fileAbs))
      files += 1
      if (!relDir) topLevel.add(d.name)
      else topLevel.add(rel.split('/')[0] + '/')
    }
  }

  await walk(abs, '')
  if (files === 0) {
    throw new BundleError(
      `Nothing to upload from ${abs}: every file is filtered out by .gitignore or the folder is empty.`,
    )
  }
  const zip = zipSync(entries, { level: 6 })
  return { zip, files, bytes, skipped, topLevel: [...topLevel].sort() }
}
