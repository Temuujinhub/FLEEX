// Shared helpers for the chat/push notification channels (Telegram, Push,
// WhatsApp, Viber). Unlike WebhookService — which posts to a tenant-supplied
// URL and therefore needs full SSRF defence — these channels target FIXED
// vendor hosts (api.telegram.org, fcm.googleapis.com, graph.facebook.com,
// chatapi.viber.com), so a plain fetch with a timeout is sufficient.

export interface PostResult {
  ok: boolean;
  status: number;
  body: string;
}

// POSTs a JSON body with a bounded timeout. Never throws on an HTTP error
// status — returns it — so a per-recipient failure can be logged without
// aborting the rest of an alert fan-out. Network/abort errors DO throw so the
// caller's catch can swallow them per-recipient.
export async function httpPostJson(
  url: string,
  headers: Record<string, string>,
  body: unknown,
  timeoutMs = 6000,
): Promise<PostResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await res.text().catch(() => '');
    return { ok: res.ok, status: res.status, body: text };
  } finally {
    clearTimeout(timer);
  }
}

// Keep only printable ASCII (0x21–0x7E). Vendor tokens are opaque ASCII; a
// copy-paste from a PDF/terminal can smuggle whitespace, a BOM, or a stray
// glyph that makes fetch throw "Cannot convert argument to a ByteString" when
// the value lands in an HTTP header. Mirrors SmsService.stripNonAscii.
export function stripNonAscii(s: string): string {
  return s.replace(/[^\x21-\x7E]/g, '');
}

// Truncates a notification body so one rogue rule can't push a multi-megabyte
// string to a vendor API. Generous enough for an event message + map link.
export function capMessage(text: string, max = 1500): string {
  return text.length > max ? text.slice(0, max - 1) + '…' : text;
}
