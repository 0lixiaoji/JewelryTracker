const CACHE_NAME = 'jewelry-v3';

// 安装时预缓存核心资源（WASM + 图标）
const PRE_CACHE = [
  '/JewelryTracker/',
  '/JewelryTracker/sql-wasm-browser.wasm',
  '/JewelryTracker/icon-192.png',
  '/JewelryTracker/icon-512.png',
  '/JewelryTracker/manifest.json',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      // 逐个缓存，一个失败不影响其他
      return Promise.allSettled(
        PRE_CACHE.map((url) =>
          fetch(url, { cache: 'reload' })
            .then((res) => {
              if (res.ok) cache.put(url, res);
            })
            .catch(() => {}),
        ),
      );
    }),
  );
  self.skipWaiting();
});

// 激活时清理旧缓存
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))),
    ),
  );
  self.clients.claim();
});

// 缓存优先（WASM 等静态资源），网络回退
self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || !request.url.startsWith('http')) return;

  // WASM 和静态资源：缓存优先
  if (
    request.url.includes('sql-wasm-browser.wasm') ||
    request.url.includes('/assets/') ||
    request.destination === 'image' ||
    request.destination === 'style' ||
    request.destination === 'script'
  ) {
    event.respondWith(
      caches.match(request).then((cached) => {
        const fetchPromise = fetch(request).then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return response;
        });
        return cached || fetchPromise;
      }),
    );
    return;
  }

  // 其他请求：网络优先
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
        }
        return response;
      })
      .catch(() => caches.match(request)),
  );
});
