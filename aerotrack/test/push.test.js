import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import webpush from 'web-push';
import { PushService, sanitizeRules } from '../lib/push.js';

const sub = (n) => ({ endpoint: `https://push.example/${n}`, keys: { p256dh: 'x', auth: 'y' } });
const plane = (o) => ({ hex: 'a1', cs: 'TEST1', reg: 'D-ABCD', type: 'GLF6', cat: 'A2', lat: 50.01, lon: 8.01, flags: 0, sq: '1000', ...o });

async function setup(source) {
  const dir = await mkdtemp(path.join(tmpdir(), 'aerotrack-'));
  const svc = new PushService({ dataDir: dir, subject: 'mailto:t@example.org', source });
  await svc.init();
  clearInterval(svc.timer);
  return { dir, svc };
}

test('Zone, Watchlist, Abklingzeit und Persistenz', async (t) => {
  const calls = { search: 0, area: 0 };
  const source = {
    search: async () => (calls.search++, { ac: [plane({ hex: 'w1', reg: 'D-WATCH', lat: 10, lon: 10 })] }),
    area: async () => (calls.area++, { ac: [plane({ hex: 'z1' }), plane({ hex: 'far', lat: 52, lon: 13 }), plane({ hex: 'em', sq: '7700', lat: 50.02 })] }),
  };
  const { dir, svc } = await setup(source);
  t.after(() => rm(dir, { recursive: true, force: true }));
  const sent = [];
  const orig = webpush.sendNotification;
  webpush.sendNotification = async (s, payload) => sent.push({ to: s.endpoint, ...JSON.parse(payload) });
  t.after(() => (webpush.sendNotification = orig));

  const rules = { watch: [{ kind: 'reg', value: 'DWATCH' }], zone: { enabled: true, lat: 50, lon: 8, km: 10, cls: 'all' }, squawk: true };
  await svc.subscribe(sub(1), rules);
  await svc.subscribe(sub(2), rules);
  await svc.checkAll();
  assert.equal(calls.search, 1, 'gleiche Suche wird gebündelt');
  assert.equal(calls.area, 1, 'gleiche Zone wird gebündelt');
  const titles = sent.filter((m) => m.to.endsWith('/1')).map((m) => m.title).sort();
  assert.deepEqual(titles, ['In deiner Zone: TEST1', 'In deiner Zone: TEST1', 'Notfall: TEST1', 'Watchlist: TEST1'].sort());
  assert.ok(!sent.some((m) => m.hex === 'far'), 'außerhalb der Zone keine Meldung');

  const before = sent.length;
  await svc.checkAll();
  assert.equal(sent.length, before, 'Abklingzeit verhindert Wiederholung');

  const saved = JSON.parse(await readFile(path.join(dir, 'subscriptions.json'), 'utf8'));
  assert.equal(saved.length, 2);
  const svc2 = new PushService({ dataDir: dir, subject: 'mailto:t@example.org', source });
  await svc2.init();
  clearInterval(svc2.timer);
  assert.equal(svc2.subs.size, 2, 'Abonnements überleben Neustart');
  assert.equal(svc2.keys.publicKey, svc.keys.publicKey, 'VAPID-Schlüssel bleiben stabil');
});

test('Abgelaufenes Abonnement (410) wird entfernt', async (t) => {
  const { dir, svc } = await setup({ search: async () => ({ ac: [] }), area: async () => ({ ac: [] }) });
  t.after(() => rm(dir, { recursive: true, force: true }));
  const orig = webpush.sendNotification;
  webpush.sendNotification = async () => { throw Object.assign(new Error('gone'), { statusCode: 410 }); };
  t.after(() => (webpush.sendNotification = orig));
  await svc.subscribe(sub(3), {});
  await assert.rejects(svc.test(sub(3).endpoint));
  assert.equal(svc.subs.size, 0);
});

test('Ungültige Eingaben werden abgewiesen bzw. bereinigt', async (t) => {
  const { dir, svc } = await setup({ search: async () => ({ ac: [] }), area: async () => ({ ac: [] }) });
  t.after(() => rm(dir, { recursive: true, force: true }));
  await assert.rejects(svc.subscribe({ endpoint: 'http://insecure/x', keys: { p256dh: 'a', auth: 'b' } }), /HTTPS/);
  await assert.rejects(svc.subscribe({ endpoint: 'https://x/y' }), /Schlüssel/);
  const r = sanitizeRules({ watch: [{ kind: 'reg', value: '<script>' }, { kind: 'evil', value: 'A' }, { kind: 'cs', value: 'DLH1' }], zone: { enabled: true, lat: 999, lon: 0, km: 9999, cls: 'x' } });
  assert.deepEqual(r.watch.map((w) => w.value), ['DLH1']);
  assert.equal(r.zone.enabled, false);
  assert.equal(r.zone.km, 200);
  assert.equal(r.zone.cls, 'all');
});
