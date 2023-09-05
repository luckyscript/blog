self.addEventListener('install', function(event) {
  self.skipWaiting(); // 立即激活新的Service Worker
  // ...
});

self.addEventListener('activate', function(event) {
  event.waitUntil(
    self.clients.claim() // 立即控制所有客户端
  );
  // ...
});

self.addEventListener('fetch', function(event) {
  event.respondWith(
    caches.match(event.request)
      .then(function(response) {
        if (response) {
          return response; // 如果缓存中存在匹配的响应，则直接返回缓存的响应
        } else {
          return fetch(event.request)
            .then(function(response) {
              return caches.open('blogCache')
                .then(function(cache) {
                  cache.put(event.request, response.clone()); // 将响应添加到缓存中
                  return response;
                });
            });
        }
      })
  );
});