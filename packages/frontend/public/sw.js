const STATIC_CACHE = 'sams-static-v7';
const OFFLINE_QUEUE_STORE = 'offline-request-queue';

const STATIC_ASSETS = [];

// ─── IndexedDB helpers for request queuing ───────────────────────────────────

function openQueueDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('sams-sw-queue', 1);
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(OFFLINE_QUEUE_STORE)) {
        db.createObjectStore(OFFLINE_QUEUE_STORE, { keyPath: 'id', autoIncrement: true });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function enqueueRequest(request) {
  const db = await openQueueDB();
  const body = await request.clone().text();
  const serialized = {
    url: request.url,
    method: request.method,
    headers: Object.fromEntries(request.headers.entries()),
    body: body,
    timestamp: Date.now(),
  };

  return new Promise((resolve, reject) => {
    const tx = db.transaction(OFFLINE_QUEUE_STORE, 'readwrite');
    const store = tx.objectStore(OFFLINE_QUEUE_STORE);
    store.add(serialized);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function getQueuedRequests() {
  const db = await openQueueDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(OFFLINE_QUEUE_STORE, 'readonly');
    const store = tx.objectStore(OFFLINE_QUEUE_STORE);
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function removeQueuedRequest(id) {
  const db = await openQueueDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(OFFLINE_QUEUE_STORE, 'readwrite');
    const store = tx.objectStore(OFFLINE_QUEUE_STORE);
    store.delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ─── Replay queued requests on reconnect ─────────────────────────────────────

async function replayQueuedRequests() {
  const queued = await getQueuedRequests();
  if (queued.length === 0) return;

  for (const entry of queued) {
    try {
      const response = await fetch(entry.url, {
        method: entry.method,
        headers: entry.headers,
        body: entry.body || undefined,
      });

      if (response.ok || response.status < 500) {
        // Remove from queue on success or client error (no point retrying 4xx)
        await removeQueuedRequest(entry.id);
      }
      // Keep in queue on 5xx for next retry
    } catch {
      // Still offline or network error — stop replaying
      break;
    }
  }
}

// ─── Install: pre-cache static assets ────────────────────────────────────────

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

// ─── Activate: clean old caches ──────────────────────────────────────────────

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== STATIC_CACHE)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

// ─── Fetch: strategy based on request type ───────────────────────────────────

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Only the dedicated attendance sync endpoint is safe to replay later.
  // Live actions such as login, starting sessions, generating links, and ending
  // sessions must fail immediately when offline so they cannot run out of time.
  if (request.method === 'POST' || request.method === 'PUT') {
    if (shouldQueueMutation(url)) {
      event.respondWith(handleMutationRequest(request));
    } else {
      event.respondWith(fetch(request));
    }
    return;
  }

  // Only handle GET requests below
  if (request.method !== 'GET') return;

  // API requests: network-first with cache fallback
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(networkFirstApi(request));
    return;
  }

  // Profile images: always network-first (avoid stale or cached 404s)
  if (url.pathname.startsWith('/uploads/')) {
    event.respondWith(networkFirst(request));
    return;
  }

  // HTML navigation: network-first so new deployments show immediately.
  if (request.mode === 'navigate' || request.destination === 'document') {
    event.respondWith(networkFirstPage(request));
    return;
  }

  // Static assets: cache-first
  event.respondWith(cacheFirst(request));
});

// ─── Handle POST/PUT requests ────────────────────────────────────────────────

function shouldQueueMutation(url) {
  return url.origin === self.location.origin && url.pathname === '/api/v1/attendance/sync';
}

async function handleMutationRequest(request) {
  try {
    const response = await fetch(request.clone());
    return response;
  } catch {
    // Network unavailable — queue the request for later replay
    await enqueueRequest(request);
    return new Response(
      JSON.stringify({ queued: true, message: 'Request queued for sync when online' }),
      {
        status: 202,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
}

// ─── Cache-first strategy (static assets) ────────────────────────────────────

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(STATIC_CACHE);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    return new Response('Offline', { status: 503 });
  }
}

// ─── Network-first strategy (HTML documents) ─────────────────────────────────

async function networkFirstPage(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(STATIC_CACHE);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;

    const fallback = await caches.match('/index.html');
    if (fallback) return fallback;

    return new Response('Offline', { status: 503 });
  }
}

// ─── Network-first (uploads and other non-API assets) ───────────────────────

async function networkFirst(request) {
  try {
    const response = await fetch(request);
    return response;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;
    return new Response('Offline', { status: 503 });
  }
}

// ─── API GET: network only (never cache auth/session responses) ─────────────

async function networkFirstApi(request) {
  try {
    return await fetch(request);
  } catch {
    return new Response(JSON.stringify({ error: 'Offline' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

// ─── Listen for online event to replay queued requests ───────────────────────

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
    return;
  }

  if (event.data?.type === 'REPLAY_QUEUE') {
    event.waitUntil(replayQueuedRequests());
  }
});

// Replay queued requests when the service worker detects connectivity is restored
// This is triggered by the sync event or by the client sending a message
self.addEventListener('sync', (event) => {
  if (event.tag === 'replay-queue') {
    event.waitUntil(replayQueuedRequests());
  }
});
