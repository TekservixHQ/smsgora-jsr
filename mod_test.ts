import { test } from "node:test";
import assert from "node:assert/strict";
import { SmsGora, SmsGoraError, verifyWebhook } from "./mod.ts";

type Seen = { method: string; url: string; headers: Headers; body: any };

function client(reply: { status?: number; body?: string; headers?: Record<string, string> } = {}) {
  const seen: Seen[] = [];
  const sms = new SmsGora({
    apiKey: "sgk_test",
    baseUrl: "https://example.test/api/",
    fetch: (async (url: string, init: RequestInit) => {
      seen.push({
        method: String(init.method),
        url: String(url),
        headers: new Headers(init.headers),
        body: init.body ? JSON.parse(String(init.body)) : undefined,
      });
      return new Response(reply.body ?? '{"success":true,"data":{"message_ids":[1873]}}', {
        status: reply.status ?? 200,
        headers: { "content-type": "application/json", ...reply.headers },
      });
    }) as typeof fetch,
  });
  return { sms, seen, last: () => seen[seen.length - 1] };
}

test("sendSms", async () => {
  const { sms, last } = client();
  const res = await sms.sendSms({ to: "+15551234567", message: "Hi" });
  assert.deepEqual(res.message_ids, [1873]);
  assert.equal(last().method, "POST");
  assert.equal(last().url, "https://example.test/api/send-sms");
  assert.equal(last().headers.get("x-api-key"), "sgk_test");
  assert.deepEqual(last().body, { recipients: ["+15551234567"], message: "Hi" });
});

test("device, SIM and schedule", async () => {
  const { sms, last } = client();
  await sms.sendSms({ to: ["+1", "+2"], message: "x", deviceId: 42, simSlot: 1, scheduleAt: new Date(Date.UTC(2026, 11, 1, 8)) });
  assert.equal(last().url, "https://example.test/api/devices/42/send-sms");
  assert.equal(last().body.sim_slot, 1);
  assert.equal(last().body.schedule_at, "2026-12-01T08:00:00Z");
});

test("bulk and other paths", async () => {
  const { sms, last } = client();
  await sms.sendBulkSms(42, { messageTemplate: "t", messages: [{ recipients: ["+1"], message: "a" }, { recipients: ["+2"] }] });
  assert.equal(last().url, "https://example.test/api/devices/42/send-bulk-sms");
  assert.equal(last().body.messageTemplate, "t");
  await sms.listReceivedSms({ phone: "+1555", since: "2026-11-01" });
  assert.equal(last().url, "https://example.test/api/received-sms?phone=%2B1555&since=2026-11-01");
  await sms.listReceivedSms({ device_id: 3, limit: 5 });
  assert.equal(last().url, "https://example.test/api/devices/3/get-received-sms?limit=5");
  await sms.cancelMessage(7);
  assert.equal(last().url, "https://example.test/api/messages/7/cancel");
  await sms.createWebhook({ url: "https://my.app/hook" });
  assert.deepEqual(last().body, { url: "https://my.app/hook", events: ["sms.received"], device_id: null });
  await sms.deleteWebhook(9);
  assert.equal(last().method, "DELETE");
  await assert.rejects(sms.sendSms({ to: [], message: "x" }), TypeError);
});

test("API errors", async () => {
  const limited = client({
    status: 429,
    body: '{"success":false,"message":"Too many requests","errors":{"recipients":["bad"]}}',
    headers: { "retry-after": "12" },
  });
  const err = await limited.sms.getAccount().catch((e) => e);
  assert.ok(err instanceof SmsGoraError);
  assert.equal(err.status, 429);
  assert.equal(err.message, "Too many requests");
  assert.equal(err.retryAfter, 12);
  assert.deepEqual(err.errors, { recipients: ["bad"] });

  const broken = client({ status: 502, body: "<html>bad gateway</html>" });
  const err2 = await broken.sms.listDevices().catch((e) => e);
  assert.equal(err2.message, "HTTP 502");
  assert.equal(err2.body, "<html>bad gateway</html>");

  assert.throws(() => new SmsGora({ apiKey: "" }), TypeError);
});

test("verifyWebhook", async () => {
  const raw = '{"event":"sms.received","data":{"from":"+15551234567"}}';
  const sig = "sha256=e125c07dfbecb498e8979383d7b9f0815efb128755409794b486d4bbb7199583";
  assert.equal(await verifyWebhook(raw, sig, "whsec_test"), true);
  assert.equal(await verifyWebhook(new TextEncoder().encode(raw), sig, "whsec_test"), true);
  assert.equal(await verifyWebhook(raw, sig, "other"), false);
  assert.equal(await verifyWebhook("{}", sig, "whsec_test"), false);
  assert.equal(await verifyWebhook(raw, null, "whsec_test"), false);
});
