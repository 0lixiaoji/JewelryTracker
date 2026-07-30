var CACHE_NAME = 'jewelry-v5';

// 安装：立即接管
self.addEventListener('install', function () {
  self.skipWaiting();
});

// 激活：清理旧缓存，接管所有页面
self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(
        keys.filter(function (k) { return k !== CACHE_NAME; })
          .map(function (k) { return caches.delete(k); })
      );
    }).then(function () {
      return self.clients.claim();
    })
  );
});

self.addEventListener('message', function (event) {
  if (event.data === 'skipWaiting') self.skipWaiting();
});

// 网络优先 + 缓存兜底
self.addEventListener('fetch', function (event) {
  var request = event.request;
  if (request.method !== 'GET') return;
  if (!request.url.startsWith('http')) return;

  event.respondWith(
    fetch(request).then(function (response) {
      // 缓存成功的响应
      if (response.ok && response.type === 'basic') {
        var clone = response.clone();
        caches.open(CACHE_NAME).then(function (cache) {
          cache.put(request, clone);
        });
      }
      return response;
    }).catch(function () {
      // 离线：尝试从缓存返回
      return caches.match(request).then(function (cached) {
        return cached || new Response('离线模式', { status: 503 });
      });
    })
  );
});
