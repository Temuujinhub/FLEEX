import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

@Injectable()
export class EmailService implements OnModuleInit {
  private readonly logger = new Logger(EmailService.name);
  private transporter?: nodemailer.Transporter;
  private from = '';
  private replyTo?: string;

  constructor(private readonly config: ConfigService) {}

  async onModuleInit() {
    const host = this.config.get<string>('SMTP_HOST');
    const user = this.config.get<string>('SMTP_USER');
    const pass = this.config.get<string>('SMTP_PASS');
    const from = this.config.get<string>('SMTP_FROM');

    if (!host || !user || !pass || !from) {
      this.logger.warn('SMTP not configured; email notifications disabled');
      return;
    }

    const port = Number(this.config.get('SMTP_PORT') ?? 587);
    // Port 465 uses implicit TLS; 587 uses STARTTLS. Allow SMTP_SECURE to
    // override when a provider exposes both on the same port.
    const secure = String(this.config.get('SMTP_SECURE') ?? (port === 465)) === 'true' || port === 465;

    this.transporter = nodemailer.createTransport({
      host,
      port,
      secure,
      auth: { user, pass },
      // Fail fast when the SMTP relay is unresponsive (e.g. Brevo quota
      // exhausted, DNS hijack, ISP block). Default nodemailer timeouts
      // are 60s+ which would race the frontend axios timeout (30s) and
      // surface as a generic "timeout exceeded" instead of an
      // actionable SMTP error.
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 15_000,
    });
    this.from = from;
    this.replyTo = this.config.get<string>('SMTP_REPLY_TO') || undefined;

    try {
      await this.transporter.verify();
      this.logger.log(`SMTP ready (${host}:${port} secure=${secure})`);
    } catch (err) {
      this.logger.error(`SMTP verify failed: ${(err as Error).message}`);
    }
  }

  enabled() {
    return !!this.transporter;
  }

  async send(to: string[], subject: string, text: string): Promise<void> {
    if (!this.transporter) {
      this.logger.warn(`SMTP disabled — skipping send to ${to.join(', ')}`);
      return;
    }
    if (to.length === 0) return;
    try {
      const info = await this.transporter.sendMail({
        from: this.from,
        to: to.join(', '),
        replyTo: this.replyTo,
        subject,
        text,
      });
      this.logger.log(
        `Sent to ${to.join(', ')} (messageId=${info.messageId} response=${info.response ?? 'n/a'})`,
      );
    } catch (err: any) {
      // Capture the full SMTP envelope so the cause is visible in the
      // container logs (auth, quota, sender verification, etc.).
      this.logger.error(
        `Send failed: to=${to.join(', ')} code=${err?.code ?? '?'} response=${err?.response ?? err?.message ?? '?'} command=${err?.command ?? '?'}`,
      );
      throw err;
    }
  }
}
