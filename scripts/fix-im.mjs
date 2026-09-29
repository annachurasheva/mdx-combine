// fix-im.mjs — возвращает im_/ картинкам Web Archive в markdown-файлах.
// Тронет ТОЛЬКО маркдаун-картинки ![...](url) с битой формой web/<14 цифр>/http.
// Обычные ссылки [текст](url) не трогает. Повторный запуск безопасен (идемпотентен).
// Запуск: node scripts/fix-im.mjs "путь_к_папке_с_md"

import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import process from 'node:process';

const ROOT = process.argv[2];
if (!ROOT) {
  console.error('Укажите папку с .md, пример: node scripts/fix-im.mjs "C:/astro-projects/astro-theme-retypeset/src/content/posts"');
  process.exit(1);
}

// было: ![alt](https://web.archive.org/web/20161026035710/http://...)
// станет: ![alt](https://web.archive.org/web/20161026035710im_/http://...)
const RX = /(!\[[^\]]*\]\(\s*)(https?:\/\/web\.archive\.org\/web\/\d{14})(\/)(http[^)\s]*)/g;

let fixedTotal = 0;

async function walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(p);
    } else if (/\.md$/i.test(entry.name)) {
      const before = await readFile(p, 'utf8');
      let count = 0;
      const after = before.replace(RX, (m, a, b, c, d) => { count++; return a + b + 'im_' + c + d; });
      if (after !== before) {
        await writeFile(p, after, 'utf8');
        fixedTotal += count;
        console.log('исправлено ' + count + ' шт: ' + p);
      }
    }
  }
}

await walk(ROOT);
console.log('Готово. Всего восстановлено im_/: ' + fixedTotal);