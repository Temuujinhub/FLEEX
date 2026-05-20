import { Injectable, Logger } from '@nestjs/common';
import type { EventEnvelope } from './types';

@Injectable()
export class WebhookService {
  private readonly logger = new Logger(WebhookService.name);

  async send(url: string, event: EventEnvelope, message: string): Promise<void> {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ event, message }),
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) {
        this.logger.warn(`Webhook ${url} responded ${res.status}`);
      }
    } catch (err) {
      this.logger.error(`Webhook ${url} error: ${(err as Error).message}`);
    }
  }
}
