import { readFile, readdir } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import process from 'node:process'

const SRC = 'src'

const ok = (cond) => !!cond

const CHECKS = [
  ['ERROR', 'escape-artifacts',
    'артефакт \\$ — подстановки печатаются текстом, а не подставляются',
    s => !/\\\$\{/.test(s) && !/\\\$\//.test(s) && !/\\\$/.test(s)],

  ['ERROR', 'date-format',
    "published должен собираться как .split('T')[0], иначе в YAML попадает время и Z",
    s => !/\.split\('T'\)(?!\[0\])/.test(s)],

  ['ERROR', 'toc-three-states',
    'toc обязан давать три состояния: false / 128 / 256',
    s => /<option value="128">/.test(s) && /<option value="256">/.test(s)],

  ['ERROR', 'authorids-list',
    'authorIds должен выводиться YAML-списком (  - id), а не строкой',
    s => /authorIds:/test(s) && /\n\s*-\s*\$\{/.test(s)],

  ['ERROR', 'slug-no-underscore',
    "slug должен чиститься до [^a-z0-9-], иначе '_' пройдёт и валидатор отвергнет",
    s => !/\[\^\\w-?\+?\]?\/g/.test(s)],

  ['WARN', 'description-forbidden',
    'в шаблоне frontmatter быть не должно ключа description — его даёт тема из toc',
    s => !/`description:/test(s)],

  ['WARN', 'persist',
    'нет localStorage: последний ввод не запомнится для серии постов',
    s => /localStorage/.test(s)],

  ['WARN', 'download-dom',
    'ссылку нужно вставить в DOM перед click() — иначе Edge/Firefox обрывают загрузку',
    s => /body\.appendChild\(a\)/.test(s)],

  ['WARN', 'revoke-timing',
    'revokeObjectURL нельзя вызывать сразу после click() — файл не успеет стартануть',
    s => !/revokeObjectURL/.test(s) || /setTimeout\([^)]*revokeObjectURL/.test(s)],

  ['WARN', 'im-clean',
    'нет очистки im_/ в ссылках Web Archive — картинки отдадут 404',
    s => /im_\//.test(s)],

  ['WARN', 'stale-buttons',
    'правки формы не гасят Download/Copy — можно скачать устаревший .md',
    s => /btnDl'\)\.disabled = true|downloadBtn\.disabled = true/.test(s)
      || /btnDl|btnCopy/.test(s) === false],

  ['WARN', 'build-stamp',
    'нет отметки версии: не определить, какой файл открыт в Edge',
    s => /build:\s*[\d.]+/.test(s)],
]

function idProblems(src) {
  const out = []
  const declared = new Map()
  for (const m of src.matchAll(/\sid="([^"]+)"/g)) {
    declared.set(m[1], (declared.get(m[1]) || 0) + 1)
  }
  for (const [id, n] of declared) {
    if (n > 1) out.push([1, 1, 'ERROR', 'dup-id', `id="${id}" встречается ${n} раз`])
  }
  for (const m of src.matchAll(/getElementById\(\s*['"]([^'"]+)['"]\s*\)/g)) {
    if (!declared.has(m[1])) {
      out.push([1, 1, 'ERROR', 'missing-id', `нет элемента id="${m[1]}" — getElementById вернёт null`])
    }
  }
  return out
}

function cardSplitProblems(src) {
  const iTitle = src.indexOf('id="title"')
  const iAbbr = src.indexOf('id="abbrlink"')
  if (iTitle < 0 || iAbbr < 0) return []
  const cardBefore = i => src.lastIndexOf('<div class="card"', i)
  return cardBefore(iTitle) === cardBefore(iAbbr)
    ? [[1, 1, 'WARN', 'shared-error-msg',
        'title и abbrlink в одной .card — сообщение об ошибке одно на двоих']]
    : []
}

function backtickProblems(src) {
  const n = (src.match(/`/g) || []).length
  return n % 2 ? [[1, 1, 'ERROR', 'odd-backtick',
    `нечётное число \` (${n}) — незакрытый шаблонный литерал, скрипт не исполнится`]] : []
}

const lineOf = (src, needle) => {
  const i = src.indexOf(needle)
  return i < 0 ? 1 : src.slice(0, i).split('\n').length
}

let bad = 0
let warned = 0

const manifest = (() => {
  try { return JSON.parse(readFileSync('VERSIONS.json', 'utf8')) }
  catch { return { current: null } }
})()

const files = (await readdir(SRC)).filter(f => /\.html$/i.test(f))

for (const f of files) {
  const rel = `${SRC}/${f}`
  const src = await readFile(rel, 'utf8')
  const problems = []

  for (const [level, code, msg, fn] of CHECKS) {
    if (!fn(src)) problems.push([lineOf(src, '<script>') || 1, 1, level, code, msg])
  }
  problems.push(...idProblems(src), ...cardSplitProblems(src), ...backtickProblems(src))

  if (manifest.current) {
    const stamp = src.match(/build:\s*([\d.]+)/)?.[1]
    if (stamp && stamp !== manifest.current.version) {
      problems.push([1, 1, 'WARN', 'build-mismatch',
        `в файле build ${stamp}, в манифесте ${manifest.current.version}`])
    }
  }

  for (const [line, col, level, code, msg] of problems) {
    console.log(`${rel}:${line}:${col}: ${level} [${code}] ${msg}`)
    if (level === 'ERROR') bad++
    else warned++
  }
}

console.log(`\nФайлов: ${files.length} · ошибок: ${bad} · предупреждений: ${warned}`)
if (bad > 0) process.exit(1)
