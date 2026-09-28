import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import process from 'node:process'

const SRC = 'src/mdx-combine.html'
const m = JSON.parse(readFileSync('VERSIONS.json', 'utf8'))

const stamp = (await readFile(SRC, 'utf8')).match(/build:\s*([\d.]+)/)?.[1]
if (!stamp) {
  console.log('ERROR src/mdx-combine.html:1:1: ERROR [build-stamp] нет отметки build: — версионировать нечего')
  process.exit(1)
}

await mkdir('archive', { recursive: true })
await writeFile(`archive/mdx-combine-${stamp}.html`, await readFile(SRC, 'utf8'), 'utf8')

const entry = { version: stamp, takenAt: new Date().toISOString().slice(0, 10) }
m.history = [...(m.history || []), entry]
m.current = entry
await writeFile('VERSIONS.json', JSON.stringify(m, null, 2) + '\n', 'utf8')
console.log(`Копия сохранена: archive/mdx-combine-${stamp}.html`)
