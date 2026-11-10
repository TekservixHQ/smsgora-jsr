/**
 * TypeScript client for the [SMS Gora SMS Gateway](https://tekservix.com/smsgora/) API.
 * Works in Deno, Bun, Node.js 18+ and edge runtimes (Cloudflare Workers, Deno Deploy, Vercel Edge).
 *
 * SMS Gora turns Android phones with ordinary SIM cards into an SMS gateway: your server
 * calls the API, a linked phone sends the text, and replies and delivery reports come back.
 *
 * @example Send an SMS
 * ```ts
 * import { SmsGora } from "@tekservix/smsgora";
 *
 * const sms = new SmsGora({ apiKey: Deno.env.get("SMSGORA_KEY")! });
 * const result = await sms.sendSms({ to: "+15551234567", message: "Your code is 482913" });
 * console.log(result.message_ids); // [1873]
 * ```
 *
 * Keep the API key on your server. API reference: https://tekservix.com/smsgora/docs/
 *
 * @module
 */

/** Package version, sent in the User-Agent header. */
export const VERSION = "1.0.0";

/** Production API base URL. */
export const DEFAULT_BASE_URL = "https://tekservix.com/smsgora/api/v1";

/** A decoded JSON object returned by the API. */
// deno-lint-ignore no-explicit-any
export type JsonObject = Record<string, any>;

/** Options for {@link SmsGora}. */
export interface SmsGoraOptions {
  /** Your SMS Gora API key (starts with `sgk_`), from SMS Gora -> API keys. Keep it on your server. */
  apiKey: string;
  /** Change only for testing. */
  baseUrl?: string;
  /** Request timeout in milliseconds (default 30000). */
  timeout?: number;
  /** Custom fetch (tests, proxies, logging). Defaults to the global `fetch`. */
  fetch?: typeof fetch;
}

/** Parameters for {@link SmsGora.sendSms}. */
export interface SendSmsParams {
  /** One number or up to 1,000 numbers in international format. */
  to: string | string[];
  /** The text, up to 1,600 characters. */
  message: string;
  /** Send from this phone (ID shown in the dashboard) instead of your best online one. */
  deviceId?: number | string;
  /** 0 = SIM 1, 1 = SIM 2. */
  simSlot?: 0 | 1;
  /** Send later: a Date or ISO 8601 string. */
  scheduleAt?: string | Date;
}

/** One entry for {@link SmsGora.sendBulkSms}. Leave `message` out to use the shared template. */
export interface BulkMessage {
  /** Numbers for this entry. */
  recipients: string[];
  /** Own text for these numbers. */
  message?: string;
}

/** Parameters for {@link SmsGora.sendBulkSms}. */
export interface BulkSmsParams {
  /** Text used for entries without their own `message`. */
  messageTemplate?: string;
  /** Up to 5,000 recipients in total. */
  messages: BulkMessage[];
}

/** Filters for {@link SmsGora.listMessages} and {@link SmsGora.listReceivedSms}. */
export interface ListParams {
  /** `in` for received, `out` for sent. */
  direction?: "in" | "out";
  /** Message status. */
  status?: string;
  /** Only this phone. */
  device_id?: number | string;
  /** Only this number. */
  phone?: string;
  /** ISO date or time. */
  since?: string;
  /** Only IDs after this one. */
  after_id?: number;
  /** Page number. */
  page?: number;
  /** Page size. */
  limit?: number;
}

/** Answer of {@link SmsGora.sendSms}. */
export interface SendSmsResult extends JsonObject {
  /** One ID per recipient. */
  message_ids: number[];
}

/** Thrown when the API answers with an error. */
export class SmsGoraError extends Error {
  /** HTTP status (0 when the request never reached the API). */
  status: number;
  /** Field errors, when the API sends them. */
  errors?: Record<string, string[]>;
  /** Parsed JSON body, or the raw text when it was not JSON. */
  body?: unknown;
  /** Seconds to wait before retrying (sent with 429). */
  retryAfter?: number;

  /** Creates an API error. */
  constructor(
    message: string,
    init: { status: number; errors?: Record<string, string[]>; body?: unknown; retryAfter?: number },
  ) {
    super(message);
    this.name = "SmsGoraError";
    this.status = init.status;
    this.errors = init.errors;
    this.body = init.body;
    this.retryAfter = init.retryAfter;
  }
}

/** SMS Gora API client. Reuse one instance per app. */
export class SmsGora {
  /** Base URL in use. */
  readonly baseUrl: string;
  #apiKey: string;
  #timeout: number;
  #fetch: typeof fetch;

  /** Creates a client. */
  constructor(options: SmsGoraOptions) {
    if (!options?.apiKey) {
      throw new TypeError("SmsGora: apiKey is required (create one in SMS Gora -> API keys)");
    }
    this.#apiKey = options.apiKey;
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.#timeout = options.timeout ?? 30_000;
    this.#fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
  }

  /** Call any documented endpoint, e.g. `request("GET", "/devices")`. Returns the `data` field. */
  // deno-lint-ignore no-explicit-any
  async request<T = any>(method: string, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = {
      "x-api-key": this.#apiKey,
      "Accept": "application/json",
      "User-Agent": `smsgora-jsr/${VERSION}`,
    };
    if (body !== undefined) headers["Content-Type"] = "application/json";

    let res: Response;
    try {
      res = await this.#fetch(this.baseUrl + path, {
        method: method.toUpperCase(),
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(this.#timeout),
      });
    } catch (err) {
      throw new SmsGoraError(`SmsGora: request failed (${(err as Error).message})`, { status: 0 });
    }

    const text = await res.text();
    let json: unknown;
    try {
      json = text ? JSON.parse(text) : undefined;
    } catch {
      json = undefined;
    }
    const obj = json && typeof json === "object" && !Array.isArray(json) ? json as JsonObject : undefined;

    if (!res.ok || obj?.success === false) {
      const retry = res.headers.get("retry-after");
      throw new SmsGoraError(typeof obj?.message === "string" ? obj.message : `HTTP ${res.status}`, {
        status: res.status,
        errors: obj?.errors,
        body: json ?? text,
        retryAfter: retry ? Number(retry) : undefined,
      });
    }
    return (obj && "data" in obj ? obj.data : json) as T;
  }

  /** Send an SMS to one number or up to 1,000. Returns `{ message_ids: [...] }`. */
  sendSms(params: SendSmsParams): Promise<SendSmsResult> {
    const recipients = Array.isArray(params.to) ? params.to : [params.to];
    if (!recipients.length || !recipients[0]) {
      return Promise.reject(new TypeError("sendSms: at least one recipient is required"));
    }
    const body: JsonObject = { recipients, message: params.message };
    if (params.simSlot !== undefined) body.sim_slot = params.simSlot;
    if (params.scheduleAt !== undefined) {
      body.schedule_at = params.scheduleAt instanceof Date
        ? params.scheduleAt.toISOString().replace(/\.\d{3}Z$/, "Z")
        : params.scheduleAt;
    }
    const path = params.deviceId !== undefined ? `/devices/${enc(params.deviceId)}/send-sms` : "/send-sms";
    return this.request("POST", path, body);
  }

  /** Different texts for different people in one call (up to 5,000 recipients). */
  sendBulkSms(deviceId: number | string, params: BulkSmsParams): Promise<JsonObject> {
    const body: JsonObject = { messages: params.messages };
    if (params.messageTemplate !== undefined) body.messageTemplate = params.messageTemplate;
    return this.request("POST", `/devices/${enc(deviceId)}/send-bulk-sms`, body);
  }

  /** Status is queued, dispatched, sent, delivered, failed or cancelled. */
  getMessage(id: number | string): Promise<JsonObject> {
    return this.request("GET", `/messages/${enc(id)}`);
  }

  /** Cancel a queued or scheduled message. */
  cancelMessage(id: number | string): Promise<JsonObject> {
    return this.request("POST", `/messages/${enc(id)}/cancel`);
  }

  /** Sent and received messages, newest first. */
  listMessages(params: ListParams = {}): Promise<JsonObject> {
    return this.request("GET", `/messages${query(params)}`);
  }

  /** Incoming SMS for all phones, or one phone with `device_id`. */
  listReceivedSms(params: ListParams = {}): Promise<JsonObject> {
    const { device_id, ...rest } = params;
    const path = device_id !== undefined ? `/devices/${enc(device_id)}/get-received-sms` : "/received-sms";
    return this.request("GET", path + query(rest));
  }

  /** One bulk batch. */
  getBatch(id: number | string): Promise<JsonObject> {
    return this.request("GET", `/batches/${enc(id)}`);
  }

  /** Your linked Android phones. */
  listDevices(): Promise<JsonObject[]> {
    return this.request("GET", "/devices");
  }

  /** One phone. */
  getDevice(id: number | string): Promise<JsonObject> {
    return this.request("GET", `/devices/${enc(id)}`);
  }

  /** Account, plan and usage. */
  getAccount(): Promise<JsonObject> {
    return this.request("GET", "/account");
  }

  /** Your webhooks. */
  listWebhooks(): Promise<JsonObject[]> {
    return this.request("GET", "/webhooks");
  }

  /** Register a webhook (events default to `sms.received`). The answer includes the secret, returned once. */
  createWebhook(
    params: { url: string; events?: string[]; deviceId?: number | null },
  ): Promise<{ id: number; url: string; events: string[]; secret: string }> {
    return this.request("POST", "/webhooks", {
      url: params.url,
      events: params.events ?? ["sms.received"],
      device_id: params.deviceId ?? null,
    });
  }

  /** Delete a webhook. */
  deleteWebhook(id: number | string): Promise<JsonObject> {
    return this.request("DELETE", `/webhooks/${enc(id)}`);
  }
}

/**
 * Check the `X-SmsGora-Signature` header (`sha256=<hex HMAC-SHA256 of the raw body>`).
 * Pass the raw request body exactly as received (e.g. `await request.text()`), before JSON parsing.
 *
 * @example Deno / Bun / Workers handler
 * ```ts
 * const raw = await req.text();
 * const ok = await verifyWebhook(raw, req.headers.get("x-smsgora-signature"), secret);
 * if (!ok) return new Response("bad signature", { status: 401 });
 * ```
 */
export async function verifyWebhook(
  rawBody: string | Uint8Array,
  signature: string | null | undefined,
  secret: string,
): Promise<boolean> {
  if (!rawBody || !rawBody.length || !signature || !secret) return false;
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const data = typeof rawBody === "string" ? encoder.encode(rawBody) : new Uint8Array(rawBody);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, data));
  const expected = "sha256=" + Array.from(mac, (b) => b.toString(16).padStart(2, "0")).join("");
  return constantTimeEqual(encoder.encode(expected), encoder.encode(signature));
}

function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

function enc(value: number | string): string {
  return encodeURIComponent(String(value));
}

function query(params: object): string {
  const pairs = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  return pairs.length ? `?${pairs.join("&")}` : "";
}

export default SmsGora;
