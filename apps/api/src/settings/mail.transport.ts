import type { SmtpSecurity } from '@fld/shared';
import { Injectable } from '@nestjs/common';
import { createTransport } from 'nodemailer';

/** The mail server in effect: the settings page's values over the environment's. */
export interface SmtpServer {
  host: string;
  port: number;
  security: SmtpSecurity;
  username: string | null;
  password: string | null;
  fromAddress: string;
  fromName: string | null;
}

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

/** Delivers mail. The tests put an outbox in its place. */
export abstract class MailTransport {
  abstract send(server: SmtpServer, message: MailMessage): Promise<void>;
}

@Injectable()
export class SmtpMailTransport extends MailTransport {
  async send(server: SmtpServer, message: MailMessage): Promise<void> {
    // A connection per message: mail is rare here, and settings may change between two.
    const transport = createTransport({
      host: server.host,
      port: server.port,
      secure: server.security === 'ssl',
      requireTLS: server.security === 'starttls',
      ignoreTLS: server.security === 'none',
      auth: server.username ? { user: server.username, pass: server.password ?? '' } : undefined,
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 30_000,
    });
    try {
      await transport.sendMail({
        from: { name: server.fromName ?? '', address: server.fromAddress },
        to: message.to,
        subject: message.subject,
        text: message.text,
        html: message.html,
      });
    } finally {
      transport.close();
    }
  }
}
