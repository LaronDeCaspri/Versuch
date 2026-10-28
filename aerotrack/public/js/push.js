// Client-Seite der Push-Benachrichtigungen: Service Worker registrieren,
// Abonnement anlegen und Alarmregeln mit dem Server abgleichen.

const supported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

async function post(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
  return res.json();
}

function b64ToBytes(b64) {
  const s = atob((b64 + '='.repeat((4 - (b64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}

export class PushClient {
  constructor() {
    this.sub = null;
    this.reg = null;
    this.syncTimer = null;
  }

  // iOS erlaubt Web-Push nur in einer zum Home-Bildschirm hinzugefügten App.
  get needsInstall() {
    const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    return ios && !navigator.standalone && !matchMedia('(display-mode: standalone)').matches;
  }

  get state() {
    if (!window.isSecureContext) return 'insecure';
    if (!supported()) return this.needsInstall ? 'install' : 'unsupported';
    if (Notification.permission === 'denied') return 'denied';
    return this.sub ? 'on' : 'off';
  }

  async init() {
    if (!supported() || !window.isSecureContext) return;
    this.reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
    this.sub = await this.reg.pushManager.getSubscription();
  }

  async enable(rules) {
    if (Notification.permission !== 'granted' && (await Notification.requestPermission()) !== 'granted') {
      throw new Error('Benachrichtigungen wurden nicht erlaubt.');
    }
    const reg = this.reg || (await navigator.serviceWorker.register('/sw.js', { scope: '/' }));
    await navigator.serviceWorker.ready;
    const { publicKey } = await fetch('/api/push/key').then((r) => r.json());
    this.sub = (await reg.pushManager.getSubscription()) ||
      (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(publicKey) }));
    await post('/api/push/subscribe', { subscription: this.sub.toJSON(), rules });
  }

  async disable() {
    if (!this.sub) return;
    const endpoint = this.sub.endpoint;
    await this.sub.unsubscribe().catch(() => {});
    this.sub = null;
    await post('/api/push/unsubscribe', { endpoint }).catch(() => {});
  }

  test() {
    return post('/api/push/test', { endpoint: this.sub?.endpoint });
  }

  // Regeländerungen gebündelt an den Server senden.
  sync(rules) {
    if (!this.sub) return;
    clearTimeout(this.syncTimer);
    this.syncTimer = setTimeout(() => {
      post('/api/push/subscribe', { subscription: this.sub.toJSON(), rules }).catch(() => {});
    }, 800);
  }
}
