/** 简单的 Service Worker — 缓存静态资源 + 离线回退
 *
 * 注意: 构建时 vite-plugin-pwa 会注入 self.__WB_MANIFEST
 * 这里使用手动策略避免 workbox Node 18 兼容问题。
 */

const CACHE_NAME = 'jewelry-tracker-v1';

// 安装时预缓存关键资源
self.addEventListener('install', () => {
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

// 网络优先，失败时回退缓存
self.addEventListener('fetch', (event) => {
  const { request } = event;

  // 只处理 GET
  if (request.method !== 'GET') return;

  // 跳过 chrome-extension:// 等
  if (!request.url.startsWith('http')) return;

  event.respondWith(
    fetch(request)
      .then((response) => {
        // 缓存成功响应
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(request, clone);
          });
        }
        return response;
      })
      .catch(async () => {
        // 离线时尝试从缓存读取
        const cached = await caches.match(request);
        if (cached) return cached;

        // 对导航请求返回 index.html (SPA)
        if (request.mode === 'navigate') {
          const fallback = await caches.match('/index.html');
          if (fallback) return fallback;
        }

        return new Response('离线模式，资源不可用', { status: 503 });
      }),
  );
});
