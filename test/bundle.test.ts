import { mkdtemp, mkdir, writeFile, symlink } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { unzipSync, strFromU8 } from 'fflate'
import { describe, expect, it } from 'vitest'

import { bundleFolder, BundleError } from '../src/bundle.js'

async function tmpProject(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'netrun-mcp-'))
  await writeFile(path.join(root, 'bot.py'), 'import os\nprint(os.getenv("BOT_TOKEN"))\n')
  await writeFile(path.join(root, 'requirements.txt'), 'aiogram\n')
  await writeFile(path.join(root, '.env'), 'BOT_TOKEN=secret\n')
  await writeFile(path.join(root, '.gitignore'), '.env\n*.log\nbuild/\n')
  await writeFile(path.join(root, 'debug.log'), 'noise\n')
  await mkdir(path.join(root, 'build'))
  await writeFile(path.join(root, 'build', 'out.js'), 'x')
  await mkdir(path.join(root, 'node_modules', 'left-pad'), { recursive: true })
  await writeFile(path.join(root, 'node_modules', 'left-pad', 'index.js'), 'x')
  await mkdir(path.join(root, 'src'))
  await writeFile(path.join(root, 'src', 'handlers.py'), 'pass\n')
  await mkdir(path.join(root, '.git'))
  await writeFile(path.join(root, '.git', 'HEAD'), 'ref: refs/heads/main\n')
  return root
}

describe('bundleFolder', () => {
  it('mirrors the server rules: skips node_modules/.git, applies .gitignore, keeps .env and .gitignore', async () => {
    const root = await tmpProject()
    const bundle = await bundleFolder(root)
    const names = Object.keys(unzipSync(bundle.zip)).sort()
    expect(names).toEqual(['.env', '.gitignore', 'bot.py', 'requirements.txt', 'src/handlers.py'])
    expect(bundle.files).toBe(5)
    expect(bundle.skipped).toEqual(expect.arrayContaining(['node_modules/', '.git/', 'build/', 'debug.log']))
    expect(bundle.topLevel).toEqual(['.env', '.gitignore', 'bot.py', 'requirements.txt', 'src/'])
    const files = unzipSync(bundle.zip)
    expect(strFromU8(files['bot.py'])).toContain('BOT_TOKEN')
  })

  it('refuses a missing folder and a file path with a plain message', async () => {
    await expect(bundleFolder('/definitely/not/here')).rejects.toBeInstanceOf(BundleError)
    const root = await tmpProject()
    await expect(bundleFolder(path.join(root, 'bot.py'))).rejects.toThrow(/Not a folder/)
  })

  it('refuses an empty result instead of uploading nothing', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'netrun-mcp-empty-'))
    await expect(bundleFolder(root)).rejects.toThrow(/Nothing to upload/)
  })

  it('skips symlinks (they could point outside the project)', async () => {
    const root = await tmpProject()
    await symlink('/etc/hosts', path.join(root, 'hosts-link'))
    const bundle = await bundleFolder(root)
    expect(Object.keys(unzipSync(bundle.zip))).not.toContain('hosts-link')
    expect(bundle.skipped).toContain('hosts-link (symlink)')
  })
})
