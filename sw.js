/* V21 离线缓存 Service Worker（部署增强 · 纯增量）
 * 项目页子路径部署安全：必须用相对路径注册（./sw.js，scope ./），
 * 本文件须与 index.html 同目录存放，作用域才会收敛到该子路径。
 *
 * 策略（针对「单文件、频繁改动、偶尔离线/弱网」）：
 *   - HTML/导航请求：stale-while-revalidate（缓存命中立即可用 + 后台静默刷新）。
 *     → 重复打开秒开、不再白屏；部署后后台自动把最新版写回缓存，下次打开即新版。
 *   - 其它 GET：cache-first，离线可用。
 *
 * ⚠️ 每次改动 index.html 重新部署前，请把下方 CACHE 版本号 +1（如 v3→v4），
 *    新 SW 安装时会清空旧缓存，保证更新可达。
 *
 * 关键改动（修复「每次打开慢 / 白屏」）：
 *   原策略 HTML 走 network-first —— 每次打开都重新拉取整个 4.5MB 单文件，弱网下
 *   长时间停在 #boot 加载层 = 用户感知的「白屏 / 很慢」。
 *   现改为 stale-while-revalidate（缓存命中立即可用、后台静默刷新）：
 *     · 重复打开：从缓存秒开，#boot 一闪即过，不再白屏；
 *     · 首次 / 缓存未命中：退回网络拉取，成功后写回缓存；
 *     · 部署上线：后台 fetch 自动把最新 index.html 写回缓存，下次打开即新版
 *       （稳妥起见仍建议部署时把 CACHE 版本号 +1，强制清旧缓存）。
 */
const CACHE = 'v21-dele-v11';
const SHELL = ['./', './index.html'];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE)
      .then(function (c) { return c.addAll(SHELL); })
      .catch(function () { /* 安装期离线/拉取失败不阻塞，运行时再补缓存 */ })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys()
      .then(function (keys) {
        return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
      })
      .then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url;
  try { url = new URL(req.url); } catch (_) { return; }
  if (url.origin !== self.location.origin) return; // 不拦截跨域

  var isHtml = req.mode === 'navigate' || url.pathname.endsWith('.html') || url.pathname.endsWith('/');

  if (isHtml) {
    // stale-while-revalidate：缓存命中立即可用（重复打开秒开，消除白屏），
    // 同时后台静默拉取最新版写回缓存（部署后下次打开即新版）。
    e.respondWith(
      caches.match(req).then(function (cached) {
        var network = fetch(req).then(function (res) {
          if (res && (res.ok || res.type === 'opaque')) {
            var copy = res.clone();
            caches.open(CACHE).then(function (c) { c.put(req, copy).catch(function () {}); }).catch(function () {});
          }
          return res;
        }).catch(function () {
          return cached || caches.match('./index.html');
        });
        return cached || network;
      })
    );
    return;
  }

  // 其它静态资源：cache-first，离线可降级到缓存的 HTML
  e.respondWith(
    caches.match(req).then(function (r) {
      if (r) return r;
      return fetch(req)
        .then(function (res) {
          if (res && (res.ok || res.type === 'opaque')) {
            var copy = res.clone();
            caches.open(CACHE).then(function (c) { c.put(req, copy).catch(function () {}); }).catch(function () {});
          }
          return res;
        })
        .catch(function () { return caches.match('./index.html'); });
    })
  );
});
