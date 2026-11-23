/**
 * Одноразовый скрипт стыковки (Агент 04): приводит внутренние ссылки в site/src
 * к единому виду с явным .html — как на живом сайте (services.html, privacy.html …).
 * Так переходы не зависят от «чистых путей» и работают и на GitHub Pages,
 * и в живом превью. Главная остаётся «/», внешние ссылки и /articles/<slug>.html
 * не трогаются.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const NAMES = [
  'thank-you-paid', 'thank-you', 'bundle-download',
  'trudovoy-spor', 'voinskiy-uchet', 'shtrafy-git',
  'services', 'podbor', 'about', 'cases', 'shablony', 'contact',
  'audit', 'lna', 'sout', 'privacy', 'consent', 'articles', 'manage',
].join('|');

/* href="/имя" | href=\"/имя\" | href='/имя' | href: '/имя' | href="/имя?... */
const re = new RegExp(`((?:href\\s*=\\\\?\\s*|href:\\s*)(?:\\\\?"|'))/(${NAMES})(?=(?:\\\\?"|')|[?#])`, 'g');

const files = execSync(
  "find site/src -type f \\( -name '*.astro' -o -name '*.ts' \\) -not -path '*/manage/*'",
  { encoding: 'utf8' },
).trim().split('\n');

let changed = 0;
for (const file of files) {
  const before = readFileSync(file, 'utf8');
  const after = before.replace(re, (_m, prefix, name) => `${prefix}/${name}.html`);
  if (after !== before) {
    writeFileSync(file, after);
    changed += 1;
    console.log('обновлён:', file);
  }
}
console.log(`Готово: файлов изменено ${changed}`);
