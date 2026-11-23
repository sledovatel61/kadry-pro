/**
 * serve-preview.mjs — живое превью собранного сайта (site/pages-dist).
 *
 * Отдаёт выгрузку ровно так, как её увидит GitHub Pages, плюс то, что
 * требует приёмка: и «чистые» пути (/contact), и прямые .html (/contact.html),
 * и кабинет /manage/ (manage/index.html), и 404.html с кодом 404.
 *
 * Запуск: node agents/agent-04-review/serve-preview.mjs
 * (порт 8080, слушает 0.0.0.0 — адрес виден как живое превью).
 */
import http from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../site/pages-dist/', import.meta.url));
const PORT = Number(process.env.PORT || 8080);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.pdf': 'application/pdf',
  '.zip': 'application/zip',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
};

function resolveFile(urlPath) {
  const clean = normalize(decodeURIComponent(urlPath.split('?')[0].split('#')[0]))
    .replace(/^(\.\.[/\\])+/, '');
  const rel = clean.replace(/^[/\\]+/, '');
  const candidates = [];

  if (rel === '' || rel.endsWith('/')) {
    candidates.push(join(ROOT, rel, 'index.html')); // / и /manage/
  } else {
    const full = join(ROOT, rel);
    candidates.push(full); // /contact.html, /img/…, /articles/x.html
    if (!extname(full)) {
      candidates.push(full + '.html'); // /contact → contact.html
      candidates.push(join(full, 'index.html')); // /manage → manage/index.html
    }
    if (full.endsWith('.html') === false && existsSync(full) && statSync(full).isDirectory()) {
      candidates.push(join(full, 'index.html'));
    }
  }

  for (const c of candidates) {
    if (existsSync(c) && statSync(c).isFile()) return c;
  }
  return null;
}

const server = http.createServer((req, res) => {
  const file = resolveFile(req.url || '/');
  if (file) {
    res.writeHead(200, {
      'Content-Type': MIME[extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    createReadStream(file).pipe(res);
    return;
  }
  const notFound = join(ROOT, '404.html');
  res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
  if (existsSync(notFound)) createReadStream(notFound).pipe(res);
  else res.end('404');
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Превью: http://0.0.0.0:${PORT}/ (чистые пути, .html, /manage/)`);
});
