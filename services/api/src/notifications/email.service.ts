import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

// EmailService talks to Brevo (or any provider) via one of two transports:
//
//   1. HTTPS API (preferred, set BREVO_API_KEY). POSTs to
//      api.brevo.com/v3/smtp/email over port 443. Works through
//      strict firewalls that block outbound 587/465/25, and surfaces
//      structured JSON errors (auth, quota, sender-not-verified).
//   2. SMTP relay (fallback). Classic nodemailer over 587/465.
//      Used when only SMTP_HOST/USER/PASS are configured.
//
// Production hit ETIMEDOUT on SMTP because the host's egress firewall
// was blocking port 587 — the HTTPS path side-steps that entirely.
@Injectable()
export class EmailService implements OnModuleInit {
  private readonly logger = new Logger(EmailService.name);
  private transporter?: nodemailer.Transporter;
  private brevoApiKey?: string;
  private from = '';
  private fromName?: string;
  private fromEmail?: string;
  private replyTo?: string;
  private transport: 'brevo-api' | 'smtp' | 'disabled' = 'disabled';

  constructor(private readonly config: ConfigService) {}

  async onModuleInit() {
    const from = this.config.get<string>('SMTP_FROM');
    const apiKey = this.config.get<string>('BREVO_API_KEY');
    const host = this.config.get<string>('SMTP_HOST');
    const user = this.config.get<string>('SMTP_USER');
    const pass = this.config.get<string>('SMTP_PASS');

    if (!from) {
      this.logger.warn('SMTP_FROM not set; email notifications disabled');
      return;
    }
    this.from = from;
    this.replyTo = this.config.get<string>('SMTP_REPLY_TO') || undefined;
    // Parse "Display Name <email@domain>" for the API path, which
    // requires name and email as separate fields.
    const m = from.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
    if (m) {
      this.fromName = m[1].trim() || undefined;
      this.fromEmail = m[2].trim();
    } else {
      this.fromEmail = from.trim();
    }

    if (apiKey) {
      this.brevoApiKey = apiKey;
      this.transport = 'brevo-api';
      this.logger.log(`Email transport: Brevo HTTPS API (from=${this.fromEmail})`);
      return;
    }

    if (!host || !user || !pass) {
      this.logger.warn('Neither BREVO_API_KEY nor SMTP_HOST/USER/PASS set; email disabled');
      return;
    }

    const port = Number(this.config.get('SMTP_PORT') ?? 587);
    const secure = String(this.config.get('SMTP_SECURE') ?? (port === 465)) === 'true' || port === 465;

    this.transporter = nodemailer.createTransport({
      host,
      port,
      secure,
      auth: { user, pass },
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 15_000,
    });
    this.transport = 'smtp';

    try {
      await this.transporter.verify();
      this.logger.log(`Email transport: SMTP ${host}:${port} secure=${secure}`);
    } catch (err) {
      this.logger.error(`SMTP verify failed: ${(err as Error).message}`);
    }
  }

  enabled() {
    return this.transport !== 'disabled';
  }

  // Surface the active transport to system-health / diagnostics.
  describe(): string {
    if (this.transport === 'brevo-api') return 'Brevo HTTPS API';
    if (this.transport === 'smtp') return `SMTP (${this.config.get('SMTP_HOST')}:${this.config.get('SMTP_PORT') ?? 587})`;
    return 'disabled';
  }

  async send(to: string[], subject: string, text: string): Promise<void> {
    if (to.length === 0) return;
    if (this.transport === 'disabled') {
      this.logger.warn(`Email disabled — skipping send to ${to.join(', ')}`);
      return;
    }
    if (this.transport === 'brevo-api') {
      return this.sendViaApi(to, subject, text);
    }
    return this.sendViaSmtp(to, subject, text);
  }

  private async sendViaApi(to: string[], subject: string, text: string): Promise<void> {
    if (!this.brevoApiKey || !this.fromEmail) {
      throw new Error('Brevo API not initialised');
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    try {
      const res = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
          'api-key': this.brevoApiKey,
        },
        body: JSON.stringify({
          sender: { name: this.fromName ?? 'Fleex', email: this.fromEmail },
          to: to.map((email) => ({ email })),
          replyTo: this.replyTo ? { email: this.replyTo } : undefined,
          subject,
          textContent: text,
        }),
        signal: controller.signal,
      });
      const bodyText = await res.text();
      if (!res.ok) {
        this.logger.error(
          `Brevo API send failed: to=${to.join(', ')} status=${res.status} body=${bodyText.slice(0, 500)}`,
        );
        // Re-throw with a clean message including the Brevo error code so
        // the operator can act (e.g. "unauthorized" → bad API key,
        // "not_enough_credits" → top up, "invalid_parameter" → bad
        // sender/recipient).
        let parsedMessage = bodyText;
        try {
          const j = JSON.parse(bodyText);
          parsedMessage = `${j.code ?? res.status}: ${j.message ?? bodyText}`;
        } catch {
          /* keep raw body */
        }
        throw new Error(`Brevo API ${res.status}: ${parsedMessage}`);
      }
      let messageId = '?';
      try {
        const j = JSON.parse(bodyText);
        messageId = j.messageId ?? '?';
      } catch {
        /* ignore */
      }
      this.logger.log(`Sent via Brevo API: to=${to.join(', ')} messageId=${messageId}`);
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        throw new Error('Brevo API timeout after 15s');
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  private async sendViaSmtp(to: string[], subject: string, text: string): Promise<void> {
    if (!this.transporter) {
      this.logger.warn(`SMTP disabled — skipping send to ${to.join(', ')}`);
      return;
    }
    try {
      const info = await this.transporter.sendMail({
        from: this.from,
        to: to.join(', '),
        replyTo: this.replyTo,
        subject,
        text,
      });
      this.logger.log(
        `Sent via SMTP: to=${to.join(', ')} messageId=${info.messageId} response=${info.response ?? 'n/a'}`,
      );
    } catch (err: any) {
      this.logger.error(
        `SMTP send failed: to=${to.join(', ')} code=${err?.code ?? '?'} response=${err?.response ?? err?.message ?? '?'} command=${err?.command ?? '?'}`,
      );
      throw err;
    }
  }
}
