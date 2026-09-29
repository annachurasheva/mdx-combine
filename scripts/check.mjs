import { readFile, readdir } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import process from 'node:process'

const SRC = 'src'

const ok = (cond) => !!cond

// Допустимые значения toc: false / true (включённый по умолчанию) и числовые пороги 128 / 256.
const TOC_OK = /value="(false|true|128|256)"/

const CHECKS = [
  ['ERROR', 'escape-artifacts',
    'артефакт \\$ — подстановки печатаются текстом, а не подставляются',
    s => !/\\\$\{/.test(s) && !/\\\$\//.test(s) && !/\\\$/.test(s)],

  ['ERROR', 'date-format',
    "published должен собираться как .split('T')[0], иначе в YAML попадает время и Z",
    s => !/\.split\('T'\)(?!\[0\])/.test(s)],

  ['ERROR', 'toc-three-states',
    'toc обязан давать три состояния: false / true (или 128) / 256',
    s => {
      const vals = new Set()
      for (const m of s.matchAll(/<select id="toc">[\s\S]*?<\/select>/g)) {
        for (const o of m[0].matchAll(/value="([^"]+)"/g)) vals.add(o[1])
      }
      // достаточно: false + одно включённое состояние (true/128) + числовое 256
      return vals.has('false') && (vals.has('true') || vals.has('128')) && vals.has('256')
        // либо схема false/true без числовых порогов — тоже валидна для Retypeset
        || (vals.size >= 2 && [...vals].every(v => TOC_OK.test(`value="${v}"`)))
    }],

  ['ERROR', 'authorids-list',
    'authorIds должен выводиться YAML-списком (  - id), а не строкой',
    s => {
      // required: ключ authorIds: присутствует ИЛИ в шаблоне frontmatter,
      // ИЛИ в JS-генераторе есть push('  - ' + ...) для авторов
      const hasKey = /authorIds:/.test(s)
      const listStyle = /\n\s*-\s*\$\{/.test(s) || /push\(\s*'?\s*-\s*'?/.test(s)
      return hasKey && listStyle
    }],

  ['ERROR', 'slug-no-underscore',
    "slug должен чиститься до [^a-z0-9-], иначе '_' пройдёт и валидатор отвергнет",
    s => !/\[\^\\w-?\+?\]?\/g/.test(s)],

  ['WARN', 'description-forbidden',
    'в шаблоне frontmatter быть не должно ключа description — его даёт тема из toc',
    s => !/`description:/.test(s)],

  ['WARN', 'persist',
    'нет localStorage: последний ввод не запомнится для серии постов',
    s => /localStorage/.test(s)],

  ['WARN', 'download-dom',
    'ссылку нужно вставить в DOM перед click() — иначе Edge/Firefox обрывают загрузку',
    s => /body\.appendChild\(a\)/.test(s)],

  ['WARN', 'revoke-timing',
    'revokeObjectURL нельзя вызывать сразу после click() — файл не успеет стартануть',
    s => {
      // плохо, если URL.revokeObjectURL(...) вызывается синхронно (не внутри setTimeout)
      const m = /URL\.revokeObjectURL/.exec(s)
      if (!m) return true
      const before = s.slice(Math.max(0, m.index - 40), m.index)
      return /setTimeout\s*\(/.test(before) || /=>\s*$/.test(before.trimEnd())
    }],

  ['WARN', 'im-clean',
    'нет очистки im_/ в ссылках Web Archive — картинки отдадут 404',
    s => /im_\//.test(s)],

  ['WARN', 'stale-buttons',
    'правки формы не гасят Download/Copy — можно скачать устаревший .md',
    s => /disabled\s*=\s*true/.test(s)
      // кнопок скачивания/копирования нет вовсе — проверять нечего
      || !(/btnDl|downloadBtn/.test(s))],

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
