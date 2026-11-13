import { run } from '@tauri-apps/cli'
import { fileURLToPath } from 'node:url'

process.chdir(fileURLToPath(new URL('../../backend/rust/', import.meta.url)))
await run(process.argv.slice(2), 'nexo-sql')
