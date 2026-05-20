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
    if (!this.transporter) return;
    if (to.length === 0) return;
    await this.transporter.sendMail({
      from: this.from,
      to: to.join(', '),
      replyTo: this.replyTo,
      subject,
      text,
    });
  }
}
