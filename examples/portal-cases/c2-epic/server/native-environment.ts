import { mkdirSync, lstatSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'

/** Only the reviewed native test entry adapts broker paths. Normal deployment env stays explicit. */
export function prepareEpicNativeEnvironment() {
  if (process.env['PORTAL_NATIVE_CASE'] !== 'c2') return
  if (!process.env['SFP_NATIVE_MODULE_POLICY'] || !process.env['SFP_NATIVE_MODULE_POLICY_HASH'])
    throw Error('Service native module binding required')
  for (const name of ['DATABASE_PATH', 'CACHE_DATABASE_PATH']) {
    const value = process.env[name]
    if (!value || !isAbsolute(value)) throw Error('Fresh broker path required: ' + name)
    const info = lstatSync(value)
    if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1) throw Error('Regular broker resource required')
  }
  process.env['DATABASE_URL'] = 'file:' + process.env['DATABASE_PATH']!.replaceAll('\\', '/')
  process.env['LITEFS_DIR'] = join(process.cwd(), 'acceptance-output', 'litefs-metadata')
  mkdirSync(process.env['LITEFS_DIR'], { recursive: true })
}
