import { readFile, writeFile, readdir, access, rm } from 'node:fs/promises'
import { join } from 'node:path'
import process from 'node:process'

const INBOX = 'inbox'
const TARGET = 'C:/astro-projects/astro-theme-retypeset/src/content/posts'   // ← поправь один раз

const REQUIRED = ['title', 'published', 'updated']
const FORBIDDEN = ['description']
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

async function exists(p) {
  try { await access(p); return true } catch { return false }
}

function split(content) {
  const m = content.match(/^---\r?\n([\s\S]+?)\r?\n---\r?\n([\s\S]*)$/m)
  return m ? { fm: m[1], body: m[2], has: true } : { fm: '', body: content, has: false }
}

function verify(name, content) {
  const out = []
  const abs = join(TARGET, name)
  const { fm, body, has } = split(content)

  if (!has) return [[abs, 1, 1, 'ERROR', 'нет frontmatter']]

  const lines = fm.split(/\r?\n/)
  const lineOf = key => lines.findIndex(l => l.startsWith(`${key}:`))
  const val = key => (lines[lineOf(key)] || '').slice(key.length + 1).trim()

  for (const key of REQUIRED) {
    const i = lineOf(key)
    if (i < 0) { out.push([abs, 1, 1, 'ERROR', `нет обязательного поля '${key}'`]); continue }
    if (!val(key) || val(key) === "''") out.push([abs, i + 1, 1, 'ERROR', `поле '${key}' пустое`])
  }

  for (const key of FORBIDDEN) {
    const i = lineOf(key)
    if (i >= 0) out.push([abs, i + 1, 1, 'ERROR', `'${key}' запрещён — его генерирует тема из toc`])
  }

  const pub = val('published')
  if (pub && !DATE_RE.test(pub))
    out.push([abs, lineOf('published') + 1, 1, 'ERROR', `published должен быть YYYY-MM-DD, сейчас '${pub}'`])

  // updated — автоматическая текущая дата: обязателен, формат даты, пустая строка — ошибка
  const upd = val('updated')
  const iUpd = lineOf('updated')
  if (iUpd < 0) {
    out.push([abs, 1, 1, 'ERROR', "нет обязательного поля 'updated'"])
  } else if (!upd || upd === "''") {
    out.push([abs, iUpd + 1, 1, 'ERROR', `поле 'updated' пустое — ожидается YYYY-MM-DD`])
  } else if (!DATE_RE.test(upd)) {
    out.push([abs, iUpd + 1, 1, 'ERROR', `updated должен быть YYYY-MM-DD, сейчас '${upd}'`])
  }

  // abbrlink опционален; если присутствует и непуст — только [a-z0-9-]
  const abbr = val('abbrlink').replace(/^['"]|['"]$/g, '')
  if (abbr && !/^[a-z0-9-]+$/.test(abbr))
    out.push([abs, lineOf('abbrlink') + 1, 1, 'ERROR', `abbrlink невалиден: '${abbr}'`])

  if (body.trim().length < 200)
    out.push([abs, 1, 1, 'WARN', 'подозрительно короткое тело'])

  if (!/^#|<h[1-6]/m.test(body))
    out.push([abs, 1, 1, 'WARN', 'в теле нет ни одного заголовка — toc не построится'])

  return out
}

if (!(await exists(TARGET))) {
  console.log(`ERROR: целевая папка не найдена: ${TARGET}`)
  console.log('Поправь константу TARGET в scripts/promote.mjs на путь к posts/ твоего Astro-проекта.')
  process.exit(1)
}

const inboxFiles = (await readdir(INBOX)).filter(f => /\.mdx?$/i.test(f))
if (!(await exists(INBOX)) || inboxFiles.length === 0) {
  console.log(`${INBOX}/ пустой — нечего доставлять`)
  process.exit(0)
}

const files = (await readdir(INBOX)).filter(f => /\.mdx?$/i.test(f))
let okCount = 0
let badCount = 0

for (const f of files) {
  const src = join(INBOX, f)
  const content = await readFile(src, 'utf8')
  const problems = verify(f, content)

  const fatal = problems.filter(p => p[3] === 'ERROR')
  for (const [file, line, col, level, msg] of problems)
    console.log(`${file}:${line}:${col}: ${level} ${msg}`)

  if (fatal.length) {
    badCount++
    console.log(`→ ${f}: НЕ перенесён (${fatal.length} ошибок), остался в inbox/`)
    continue
  }
  await writeFile(join(TARGET, f), content, 'utf8')
  await rm(src)
  okCount++
  console.log(`→ ${f}: перенесён, очищен от мусора`)
}

console.log(`\nПеренесено: ${okCount} · отклонено: ${badCount}`)
if (badCount) process.exit(1)
