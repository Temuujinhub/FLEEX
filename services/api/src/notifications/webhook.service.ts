import { Injectable, Logger } from '@nestjs/common';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import type { EventEnvelope } from './types';

// Returns true for any IP an outbound webhook must never reach: loopback,
// private RFC1918, link-local (incl. 169.254.169.254 cloud metadata), CGNAT,
// multicast/reserved, and their IPv6 equivalents. Blocks SSRF where a tenant
// points a NotificationRule.webhookUrl at internal infrastructure.
function isBlockedAddress(ip: string): boolean {
  if (ip.includes('.') && isIP(ip) === 4) {
    const [a, b] = ip.split('.').map(Number);
    if (a === 0) return true; // 0.0.0.0/8
    if (a === 10) return true; // 10.0.0.0/8 private
    if (a === 127) return true; // loopback
    if (a === 169 && b === 254) return true; // link-local + cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12 private
    if (a === 192 && b === 168) return true; // 192.168.0.0/16 private
    if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT
    if (a >= 224) return true; // 224.0.0.0/3 multicast + reserved
    return false;
  }
  const v6 = ip.toLowerCase();
  if (v6.startsWith('::ffff:')) return isBlockedAddress(v6.slice('::ffff:'.length)); // IPv4-mapped
  if (v6 === '::1' || v6 === '::') return true; // loopback / unspecified
  if (v6.startsWith('fe80')) return true; // link-local
  if (v6.startsWith('fc') || v6.startsWith('fd')) return true; // fc00::/7 unique-local
  if (v6.startsWith('ff')) return true; // ff00::/8 multicast
  return false;
}

@Injectable()
export class WebhookService {
  private readonly logger = new Logger(WebhookService.name);

  async send(url: string, event: EventEnvelope, message: string): Promise<void> {
    let target: URL;
    try {
      target = new URL(url);
    } catch {
      this.logger.warn(`Webhook URL is not a valid URL; skipping: ${url}`);
      return;
    }
    if (target.protocol !== 'http:' && target.protocol !== 'https:') {
      this.logger.warn(`Webhook URL scheme rejected (${target.protocol}); skipping`);
      return;
    }

    // Resolve the host and reject if ANY address maps to a private/reserved
    // range. Literal IP hosts are validated directly.
    const host = target.hostname.replace(/^\[|\]$/g, '');
    try {
      const addresses = isIP(host)
        ? [host]
        : (await lookup(host, { all: true })).map((r) => r.address);
      if (addresses.length === 0 || addresses.some(isBlockedAddress)) {
        this.logger.warn(`Webhook URL resolves to a private/reserved address; blocked: ${host}`);
        return;
      }
    } catch (err) {
      this.logger.warn(`Webhook host resolution failed for ${host}: ${(err as Error).message}`);
      return;
    }

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ event, message }),
        // Never follow redirects — a 3xx could bounce to an internal host
        // that our pre-flight resolution never saw.
        redirect: 'manual',
        signal: AbortSignal.timeout(5000),
      });
      if (res.status >= 300 && res.status < 400) {
        this.logger.warn(`Webhook ${url} returned a redirect (${res.status}); not following`);
        return;
      }
      if (!res.ok) {
        this.logger.warn(`Webhook ${url} responded ${res.status}`);
      }
    } catch (err) {
      this.logger.error(`Webhook ${url} error: ${(err as Error).message}`);
    }
  }
}
