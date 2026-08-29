// Service Worker — アプリシェルをキャッシュしてオフラインでも起動可能にする
const CACHE_NAME = 'meallog-v5';
const APP_SHELL = [
  './',
  './index.html',
  './css/style.css',
  './js/app.js',
  './js/db.js',
  './js/gemini.js',
  './js/github.js',
  './js/export.js',
  './js/nutrition.js',
  './js/suggest.js',
  './js/templates.js',
  './js/templates-seed.js',
  './manifest.json',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME)
      // cache:'reload' でHTTPキャッシュをバイパスし、必ず最新版をプリキャッシュする
      .then(cache => cache.addAll(APP_SHELL.map(u => new Request(u, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  // API呼び出し(Gemini/GitHub)はキャッシュしない
  if (url.origin !== location.origin) return;
  // CSS/JSはHTTPキャッシュをバイパスして取得する。GitHub Pagesがmax-age=600を返すため、
  // これがないとHTMLだけ新しくCSS/JSが古いまま混在してレイアウトが崩れる。
  // navigateリクエストはRequestを作り直すとmodeが変わるため、そのまま使う。
  const req = e.request.mode === 'navigate'
    ? e.request
    : new Request(e.request, { cache: 'reload' });
  // アプリシェルは network-first(更新を取り込みつつオフラインはキャッシュ)
  e.respondWith(
    fetch(req)
      .then(res => {
        const copy = res.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }))
  );
});
