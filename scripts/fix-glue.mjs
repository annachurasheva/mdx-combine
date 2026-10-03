// fix-glue.mjs — восстанавливает границы абзацев в стыках вида «оккупантов.В».
// По умолчанию DRY-RUN: только печатает найденное, НИЧЕГО не пишет.
// Запись — только с флагом --apply.
// Запуск:
//   node scripts/fix-glue.mjs "путь\к\posts"            <- сухой прогон
//   node scripts/fix-glue.mjs "путь\к\posts" --apply    <- запись

import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import process from 'node:process';

const ROOT = process.argv[2];
const APPLY = process.argv.includes('--apply');
if (!ROOT) { console.error('Укажите папку: node scripts/fix-glue.mjs "путь" [--apply]'); process.exit(1); }

// Стык: ≥2 строчных/цифр + точка + заглавная, после которой строчная или пробел.
// Диапазоны — через \u-коды (кириллица не зависит от копипасты).
// Защита: «С.В.» (заглавная перед точкой), «г.Феодосия» (1 буква), «big3059.JPG»
// (после заглавной — заглавная) — не совпадают.
const RX = /(?<=[\u0430-\u044f\u04510-9]{2,}\.)(?<!\b(?:\u0433\u043e\u0440|\u0434\u0435\u0440|\u0441\u0435\u043b|\u043f\u043e\u0441|\u0443\u043b|\u043f\u0435\u0440|\u0441\u0442|\u0442\u043e\u0432|\u0438\u043c|\u0433\u043e\u0441|\u043a\u0430\u043f|\u043b\u0435\u0439\u0442|\u0433\u0435\u043d|\u043a\u043e\u043c|\u0440\u0435\u0434|\u0438\u0437\u0434|\u0441\u0442\u0440|\u0433\u043b)\.)([\u0410-\u042f\u0401A-Z\u00ab])(?=[\u0430-\u044f\u0451a-z\s])/g;

let total = 0;
async function walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) { await walk(p); continue; }
    if (!/\.md$/i.test(entry.name)) continue;
    const before = await readFile(p, 'utf8');
    const matches = [...before.matchAll(RX)];
    if (!matches.length) continue;
    total += matches.length;
    console.log('\n== ' + entry.name + ' — стыков: ' + matches.length);
    matches.slice(0, 6).forEach(m => {
      const s = Math.max(0, m.index - 40);
      console.log('   …' + before.slice(s, m.index + 40).replace(/\n/g, ' ') + '…');
    });
    if (APPLY) {
      await writeFile(p, before.replace(RX, '\n\n$1'), 'utf8');
      console.log('   -> записано');
    }
  }
}
await walk(ROOT);
console.log('\nВсего стыков: ' + total + (APPLY ? ' (записано)' : ' (DRY-RUN: ничего не записано. Повтор с --apply)'));