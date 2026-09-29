import { readFile, readdir } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import process from 'node:process'

const SRC = 'src'

// Единый набор правил для комбайна (build 1.1.2+):
// R6 toc — ровно true/false; R3 published — ручной ввод; R4 updated — авто-дата;
// R7 имя файла = только slug; R8 PERSIST с abbrlink без title/content/published;
// R9 артефакт экранирования — только \$ перед $.

const CHECKS = [
  ['ERROR', 'escape-artifacts',
    'артефакт \\$ — подстановки печатаются текстом, а не подставляются',
    s => !/\\\$\{/.test(s)],

  ['ERROR', 'date-format',
    "split('T') без [0]: в YAML попадёт время и Z",
    s => !/\.split\('T'\)(?!\[0\])/.test(s)],

  ['ERROR', 'toc-boolean',
    'в select toc значения должны быть ровно true и false; числовые пороги запрещены',
    s => {
      const m = /<select id="toc">([\s\S]*?)<\/select>/.exec(s)
      if (!m) return false
      const vals = [...m[1].matchAll(/value="([^"]+)"/g)].map(x => x[1])
      return vals.length === 2 && vals.includes('true') && vals.includes('false')
    }],

  ['ERROR', 'dates',
    'published — только ручной ввод (input type=date id=published), текущая дата — только в updated',
    s => {
      // обязательное поле ручной даты
      if (!/<input[^>]+type="date"[^>]+id="published"|<input[^>]+id="published"[^>]+type="date"/.test(s)) return false
      // автоподстановка текущей даты в published запрещена
      if (/published:\s*'?\s*\+?\s*now\b|publishedEl\.value\s*=\s*now\b/.test(s)) return false
      // пустая строка updated в шаблоне вывода запрещена
      if (/['"`]updated:\s*''/.test(s)) return false
      // updated обязан выводиться из текущей даты
      if (!/['"]updated:\s*['"]\s*\+\s*(?:data\.)?(now|today)\b|\{\s*updated:\s*(now|today)\b/.test(s)) return false
      return true
    }],

  ['ERROR', 'filename-slug-only',
    'имя файла собирается только из slug; abbrlink в имени файла не участвует',
    s => !/abbrRaw\s*\+\s*['"]-['"]/.test(s)],

  ['ERROR', 'persist',
    "PERSIST должен содержать 'abbrlink' и не содержать 'title'/'content'/'published'",
    s => {
      const m = /const PERSIST\s*=\s*\[([^\]]*)\]/.exec(s)
      if (!m) return false
      const list = m[1]
      if (/'(title|content|published)'/.test(list)) return false
      return /'abbrlink'/.test(list)
    }],

  ['ERROR', 'authorids-list',
    'authorIds должен выводиться YAML-списком (  - id), а не строкой',
    s => {
      const hasKey = /authorIds:/.test(s)
      const listStyle = /\n\s*-\s*\$\{/.test(s) || /push\(\s*'?\s*-\s*'/.test(s)
      return hasKey && listStyle
    }],
  ['ERROR', 'im-mutilation',
    'комбайн не имеет права резать префикс im_/ — абсолютные URL Web Archive проходят как есть',
    s => !/replace\([^)]*im_\//.test(s)],

  ['ERROR', 'slug-clean',
    'в slugify должна быть очистка от всего, кроме [^a-z0-9-]',
    s => /\[\^a-z0-9-\]/.test(s)],

  ['WARN', 'description-forbidden',
    'в шаблоне frontmatter быть не должно ключа description — его даёт тема из toc',
    s => !/`description:/.test(s)],

  ['WARN', 'download-dom',
    'ссылку нужно вставить в DOM перед click() — иначе Edge/Firefox обрывают загрузку',
    s => /body\.appendChild\(a\)/.test(s)],

  ['WARN', 'revoke-timing',
    'revokeObjectURL нельзя вызывать сразу после click() — файл не успеет стартануть',
    s => {
      const m = /URL\.revokeObjectURL/.exec(s)
      if (!m) return true
      const before = s.slice(Math.max(0, m.index - 40), m.index)
      return /setTimeout\s*\(/.test(before) || /=>\s*$/.test(before.trimEnd())
    }],

  ['WARN', 'stale-buttons',
    'правки формы не гасят Download/Copy — можно скачать устаревший .md',
    s => /disabled\s*=\s*true/.test(s)
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
    if (n > 1) out.push([lineOf(src, `id="${id}"`), 1, 'ERROR', 'dup-id', `id="${id}" встречается ${n} раз`])
  }
  for (const m of src.matchAll(/getElementById\(\s*['"]([^'"]+)['"]\s*\)/g)) {
    if (!declared.has(m[1])) {
      out.push([lineOf(src, `getElementById('${m[1]}')`), 1, 'ERROR', 'missing-id',
        `нет элемента id="${m[1]}" — getElementById вернёт null`])
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
