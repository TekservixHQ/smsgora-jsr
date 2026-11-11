# @tekservix/smsgora

[![JSR](https://jsr.io/badges/@tekservix/smsgora)](https://jsr.io/@tekservix/smsgora)
[![JSR Score](https://jsr.io/badges/@tekservix/smsgora/score)](https://jsr.io/@tekservix/smsgora)
[![tests](https://github.com/TekservixHQ/smsgora-jsr/actions/workflows/tests.yml/badge.svg)](https://github.com/TekservixHQ/smsgora-jsr/actions/workflows/tests.yml)

**SMS Gora SMS Gateway** - official TypeScript client on JSR (Deno, Bun, Node, edge): send and receive SMS through your own Android phones. By Tekservix.

TypeScript client for the [SMS Gora SMS Gateway](https://tekservix.com/smsgora/) API, for Deno, Bun, Node.js and edge runtimes.

SMS Gora turns Android phones with ordinary SIM cards into an SMS gateway. Your server calls the API, a linked phone sends the text, and replies and delivery reports come back to you. There's no sender ID registration and no per-message fee from us: your mobile operator bills the texts like any SMS.

- Written in TypeScript, uses only web standards (`fetch`, Web Crypto)
- Runs on Deno, Deno Deploy, Bun, Node.js 18+, Cloudflare Workers and Vercel Edge
- No dependencies; webhook signature check built in

## Install

```bash
deno add jsr:@tekservix/smsgora
npx jsr add @tekservix/smsgora    # Node.js
bunx jsr add @tekservix/smsgora   # Bun
```

## Quick start

Create an API key in the SMS Gora dashboard (SMS Gora -> API keys) and keep it on your server.

```ts
import { SmsGora } from "@tekservix/smsgora";

const sms = new SmsGora({ apiKey: Deno.env.get("SMSGORA_KEY")! }); // process.env.SMSGORA_KEY on Node/Bun

const result = await sms.sendSms({ to: "+15551234567", message: "Your verification code is 482913" });
console.log(result.message_ids); // [1873]
```

## Sending

```ts
// Several recipients (up to 1,000 per call)
await sms.sendSms({ to: ["+15551234567", "+447700900123"], message: "Your order has shipped" });

// From a chosen phone and SIM, scheduled for later
await sms.sendSms({
  to: "+15551234567",
  message: "Reminder: your appointment is tomorrow at 10:00",
  deviceId: 42,
  simSlot: 1, // 0 = SIM 1, 1 = SIM 2
  scheduleAt: new Date("2026-12-01T08:00:00Z"),
});

// Different texts for different people in one call (up to 5,000 recipients)
await sms.sendBulkSms(42, {
  messageTemplate: "Hello, your parcel is ready for pickup.",
  messages: [
    { recipients: ["+15551234567"], message: "Hi Aline, parcel #1042 is ready." },
    { recipients: ["+15557654321"] },
  ],
});
```

## Delivery status and incoming SMS

```ts
const msg = await sms.getMessage(1873);
console.log(msg.status); // queued -> dispatched -> sent -> delivered (or failed)

await sms.cancelMessage(1874); // works while queued or scheduled

const inbox = await sms.listReceivedSms({ since: "2026-11-01", limit: 50 });
const phones = await sms.listDevices();
const account = await sms.getAccount();
```

Anything else in the [API reference](https://tekservix.com/smsgora/docs/) is one call away:

```ts
const batch = await sms.request("GET", "/batches/311");
```

## Webhooks

Add your HTTPS URL in SMS Gora -> Webhooks (or with `createWebhook`) and keep the secret. Each request carries `X-SmsGora-Signature: sha256=...`, an HMAC-SHA256 of the raw body. Deno example (the same handler works in Bun and Cloudflare Workers):

```ts
import { verifyWebhook } from "@tekservix/smsgora";

Deno.serve(async (req) => {
  const raw = await req.text();
  const ok = await verifyWebhook(raw, req.headers.get("x-smsgora-signature"), Deno.env.get("SMSGORA_WEBHOOK_SECRET")!);
  if (!ok) return new Response("bad signature", { status: 401 });

  const event = JSON.parse(raw);
  if (event.event === "sms.received") {
    // event.data.from, event.data.message: queue slow work, answer fast
  }
  return new Response("ok"); // answer within 10 seconds
});
```

## Errors

Failed calls throw `SmsGoraError` with `status`, `message`, field `errors` and, on 429, `retryAfter` in seconds.

```ts
try {
  await sms.sendSms({ to: "+15551234567", message: "Hi" });
} catch (e) {
  if (e instanceof SmsGoraError && e.status === 429) {
    // 300 requests/minute per key, or plan limit: wait e.retryAfter seconds
  }
}
```

Never put the key in browser code or a mobile app: anyone could read it. Call the API from your server or an edge function.

## Migrating from TextBee

SMS Gora accepts TextBee-style requests, so most integrations switch by changing the base URL and key. See the [compatibility notes](https://tekservix.com/smsgora/docs/).

## More from Tekservix

- [WAservix WhatsApp API Gateway](https://tekservix.com/waservix/): send WhatsApp messages from your own number ([`jsr:@tekservix/waservix`](https://jsr.io/@tekservix/waservix))
- [AI Sales Agent](https://tekservix.com/ai-sales-agent): answers customers on WhatsApp and SMS using your website's content
- [Website to App](https://tekservix.com/mobile-apps): turn your website into Android and iOS apps
- SMS Gora is also on npm, PyPI, Packagist, Go, Maven (JitPack), NuGet, RubyGems, Swift, crates.io and pub.dev: see [github.com/TekservixHQ](https://github.com/TekservixHQ)

## License

MIT
