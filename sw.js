/* Mnemo Service Worker — offline cache + push notifications
   Fixes:
   1. Per-build cache name (BUILD_ID) — bump on every deploy so updates roll out
   2. Real install error handling: log failures, retry once, report to clients
   3. Stale-while-revalidate for static assets (cache-first for instant load,
      background refresh for next visit). HTML stays network-first so users
      always see the latest shell when online.
*/

// ── 1. Cache versioning ────────────────────────────────────────────────────
// Bump BUILD_ID on every deploy. A simple convention: ISO date + short tag.
// You can also auto-replace this string at build time (e.g. with a sed step
// that injects the git short SHA).
const BUILD_ID = '2026-05-26-classrooms';
const CACHE = `mnemo-${BUILD_ID}`;

const ASSETS = [
  './',
  './app.html',
  './style.css',
  './polish.css',
  './script.js',
  './app-init.js',
  './fsrs.js',
  './flashcards.js',
  './calender.js',
  './renderdecks.js',
  './settings.js',
  './today.js',
  './topic.js',
  './ai-generator.js',
  './audio.js',
  './apkg-import.js',
  './extras.js',
  './classroom.js',
  './mnemo-bridge.js',
  './occlusion.js',
  './auth.html',
];

// ── Helpers ────────────────────────────────────────────────────────────────
async function broadcast(message) {
  try {
    const clients = await self.clients.matchAll({ includeUncontrolled: true });
    clients.forEach((c) => { try { c.postMessage(message); } catch {} });
  } catch {}
}

// Try to add each asset individually so one bad file doesn't abort the whole install.
// Retries each failed asset once before giving up.
async function precacheAll(cache, urls) {
  const failed = [];
  await Promise.all(urls.map(async (url) => {
    try {
      // bypass HTTP cache so we get the freshest copy at install time
      const req = new Request(url, { cache: 'reload' });
      const res = await fetch(req);
      if (!res || !res.ok) throw new Error(`bad response ${res && res.status}`);
      await cache.put(url, res.clone());
    } catch (err) {
      console.warn('[Mnemo SW] precache failed, will retry:', url, err);
      try {
        const res2 = await fetch(new Request(url, { cache: 'reload' }));
        if (!res2 || !res2.ok) throw new Error(`bad response ${res2 && res2.status}`);
        await cache.put(url, res2.clone());
      } catch (err2) {
        console.error('[Mnemo SW] precache permanently failed:', url, err2);
        failed.push({ url, error: String(err2 && err2.message || err2) });
      }
    }
  }));
  return failed;
}

// ── 2. Install: real error reporting ───────────────────────────────────────
self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    const failed = await precacheAll(cache, ASSETS);
    if (failed.length) {
      console.error('[Mnemo SW] install completed with errors:', failed);
      // Tell any pages so they can surface a toast like
      // "Update failed. Check your connection."
      broadcast({ type: 'mnemo-sw-install-error', failed });
    } else {
      console.log('[Mnemo SW] install complete:', CACHE);
    }
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys.filter((k) => k !== CACHE && k.startsWith('mnemo-'))
          .map((k) => caches.delete(k))
    );
    await self.clients.claim();
    broadcast({ type: 'mnemo-sw-activated', cache: CACHE });
  })());
});

// ── 3. Fetch strategies ────────────────────────────────────────────────────
// HTML / navigations  → network-first (always try to get the latest shell)
// Same-origin assets  → stale-while-revalidate
// Cross-origin        → just fetch (don't cache opaque responses by default)
async function networkFirst(req) {
  const cache = await caches.open(CACHE);
  try {
    const fresh = await fetch(req);
    if (fresh && fresh.ok) cache.put(req, fresh.clone()).catch(() => {});
    return fresh;
  } catch (err) {
    const cached = await cache.match(req);
    return cached || cache.match('./app.html') || Response.error();
  }
}

async function staleWhileRevalidate(req) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(req);
  const networkPromise = fetch(req).then((res) => {
    if (res && res.ok && (res.type === 'basic' || res.type === 'default')) {
      cache.put(req, res.clone()).catch(() => {});
    }
    return res;
  }).catch((err) => {
    console.warn('[Mnemo SW] background refresh failed:', req.url, err);
    return null;
  });
  // Serve cache immediately if we have it; otherwise wait for network.
  if (cached) {
    // Don't await — fire-and-forget so cache updates for next visit.
    networkPromise;
    return cached;
  }
  const fresh = await networkPromise;
  return fresh || Response.error();
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;

  // HTML / navigations → network-first
  if (req.mode === 'navigate' || req.destination === 'document') {
    e.respondWith(networkFirst(req));
    return;
  }

  // Cross-origin → just fetch (don't pollute cache with opaque responses)
  if (!sameOrigin) return;

  // Same-origin assets → stale-while-revalidate
  e.respondWith(staleWhileRevalidate(req));
});

// ── Notifications ──────────────────────────────────────────────────────────
self.addEventListener('message', (e) => {
  const { type, payload } = e.data || {};
  if (type === 'mnemo-notify') {
    self.registration.showNotification(payload?.title || 'Mnemo', {
      body: payload?.body || 'You have cards due.',
      icon: './icon.svg',
      badge: './icon.svg',
      tag: 'mnemo-reminder',
    });
  } else if (type === 'mnemo-skip-waiting') {
    self.skipWaiting();
  }
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil((async () => {
    const list = await self.clients.matchAll({ type: 'window' });
    for (const c of list) { if ('focus' in c) return c.focus(); }
    if (self.clients.openWindow) return self.clients.openWindow('./app.html');
  })());
});
