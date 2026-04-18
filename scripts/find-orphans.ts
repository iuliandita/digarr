import { readFileSync } from 'node:fs'
import { Glob } from 'bun'
import { en } from '../src/core/i18n/messages/en'

const keys = Object.keys(en)
const glob = new Glob('src/**/*.{ts,tsx}')
const files: string[] = []
for await (const f of glob.scan({ cwd: '.' })) files.push(f)
const body = files
  .filter((f) => !f.includes('i18n/messages/'))
  .map((f) => readFileSync(f, 'utf8'))
  .join('\n')

// Known dynamic-key prefixes (accessed via template literals)
const dynamicPrefixes = [
  'discoveryMode.', // discoveryMode.${mode}.label etc
  'subscription.feed.', // subscription.feed.${sourceId}
  'pipeline.stage.', // pipeline.stage.${stageName}
  'pipeline.description.',
  'pipeline.message.',
  'integration.',
]
// Verify each dynamic prefix actually has template-literal access in code
function usesDynamic(prefix: string) {
  return (
    body.includes('`' + prefix) ||
    body.includes("'" + prefix + '${') ||
    new RegExp('\\b' + prefix.replace('.', '\\.') + '\\$\\{').test(body)
  )
}
const confirmedDynamic = dynamicPrefixes.filter(usesDynamic)
console.error('Dynamic prefixes confirmed:', confirmedDynamic)

const orphans = keys.filter((k) => {
  if (body.includes(k)) return false
  for (const p of confirmedDynamic) {
    if (k.startsWith(p)) return false
  }
  return true
})
console.log(JSON.stringify(orphans, null, 2))
console.error('count:', orphans.length)
