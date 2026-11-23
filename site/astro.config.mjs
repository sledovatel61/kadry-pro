import { defineConfig } from 'astro/config';

/* kadry-pro.ru — статика для GitHub Pages.
   build.format: 'file' — каждая страница компилируется в отдельный .html,
   чтобы сохранить ВСЕ существующие адреса (/services.html, /podbor.html, …).
   server.allowedHosts — превью Arena открывается по внешнему хосту
   вида <port>-<id>.e2b.app, иначе dev-сервер отвечает 403 «Blocked request». */
export default defineConfig({
  site: 'https://kadry-pro.ru',
  output: 'static',
  trailingSlash: 'never',
  build: {
    format: 'file',
    inlineStylesheets: 'auto',
  },
  server: {
    host: true,
    port: Number(process.env.PORT || 4321),
    allowedHosts: true,
  },
  vite: {
    server: { allowedHosts: true },
    build: { assetsInlineLimit: 1024 },
  },
});
