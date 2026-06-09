/**
 * Register the service worker for offline support.
 */
let hasReloadedForServiceWorkerUpdate = false;

export function registerServiceWorker(): void {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', async () => {
      try {
        const registration = await navigator.serviceWorker.register('/sw.js', {
          scope: '/',
          updateViaCache: 'none',
        });
        console.log('[SW] Registered with scope:', registration.scope);

        navigator.serviceWorker.addEventListener('controllerchange', () => {
          if (hasReloadedForServiceWorkerUpdate) return;
          hasReloadedForServiceWorkerUpdate = true;
          window.location.reload();
        });

        void registration.update();
        window.setInterval(() => {
          void registration.update();
        }, 5 * 60 * 1000);

        // Check for updates periodically
        registration.addEventListener('updatefound', () => {
          const newWorker = registration.installing;
          if (newWorker) {
            newWorker.addEventListener('statechange', () => {
              if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                newWorker.postMessage({ type: 'SKIP_WAITING' });
              } else if (newWorker.state === 'activated') {
                console.log('[SW] New service worker activated');
              }
            });
          }
        });

        // When device comes back online, notify SW to replay queued requests
        window.addEventListener('online', () => {
          if (navigator.serviceWorker.controller) {
            navigator.serviceWorker.controller.postMessage({ type: 'REPLAY_QUEUE' });
          }

          // Also try Background Sync API if available
          if ('sync' in registration) {
            (registration as any).sync.register('replay-queue').catch(() => {
              // Background Sync not supported or permission denied — message fallback is enough
            });
          }
        });
      } catch (error) {
        console.error('[SW] Registration failed:', error);
      }
    });
  }
}
