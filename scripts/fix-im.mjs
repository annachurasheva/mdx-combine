// fix-im.mjs — восстанавливает ссылки Web Archive в markdown-файлах.
// Чинит две битые формы, НЕ трогает целевую:
//   битая A (склейка):  .../web/20161026035710im_http://...  -> .../20161026035710im_/http://...
//   битая B (обрезана): .../web/20161026035710/http://...     -> .../20161026035710im_/http://...
//   целевая:            .../web/20161026035710im_/http://...  (не изменяется)
// Обычные ссылки [текст](url): чинит только склейку im_ -> слеш.
// Повторный запуск безопасен. Запуск: node scripts/fix-im.mjs "путь_к_папке"

import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import process from 'node:process';

const ROOT = process.argv[2];
if (!ROOT) {
  console.error('Укажите папку с .md: node scripts/fix-im.mjs "C:/.../posts"');
  process.exit(1);
}

// картинки: после 14 цифр стоит im_ (склейка) или / (обрезана) — вернуть im_/
const RX_IMG = /(!\[[^\]]*\]\(\s*)(https?:\/\/web\.archive\.org\/web\/\d{14})(im_|\/)(https?:\/\/[^)\s]+)/g;
// обычные ссылки (без ! перед [): только склейка im_ -> слеш
const RX_LNK = /(?<!\!)(\[[^\]]*\]\(\s*)(https?:\/\/web\.archive\.org\/web\/\d{14})im_(https?:\/\/[^)\s]+)/g;

let total = 0;

async function walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) { await walk(p); continue; }
    if (!/\.md$/i.test(entry.name)) continue;
    const before = await readFile(p, 'utf8');
    let count = 0;
    let after = before.replace(RX_IMG, (m, a, b, c, d) => { count++; return a + b + 'im_/' + d; });
    after = after.replace(RX_LNK, (m, a, b, c) => { count++; return a + b + '/' + c; });
    if (after !== before) {
      await writeFile(p, after, 'utf8');
      total += count;
      console.log('исправлено ' + count + ': ' + p);
    }
  }
}

await walk(ROOT);
console.log('Готово. Всего восстановлено ссылок: ' + total);