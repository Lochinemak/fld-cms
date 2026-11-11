import { APP_NAME, renderMailTemplate, type MailTemplateKey } from '@fld/shared';
import { BadRequestException, Injectable } from '@nestjs/common';
import { MailTransport } from './mail.transport.js';
import { PlatformSettingsService } from './platform-settings.service.js';

@Injectable()
export class MailService {
  constructor(
    private readonly settings: PlatformSettingsService,
    private readonly transport: MailTransport,
  ) {}

  /** Sends the template filled in with `values`. Rejects without a mail server, or when it refuses. */
  async sendTemplate(
    key: MailTemplateKey,
    to: string,
    values: Readonly<Record<string, string>>,
  ): Promise<void> {
    const [server, template] = await Promise.all([
      this.settings.smtpServer(),
      this.settings.mailTemplate(key),
    ]);
    if (!server) {
      throw new Error('No mail server is set');
    }
    const text = renderMailTemplate(template.body, values);
    await this.transport.send(server, {
      to,
      subject: renderMailTemplate(template.subject, values),
      text,
      html: toHtml(text),
    });
  }

  /** Sends a test message, with the mail server's answer when it fails. */
  async sendTest(to: string): Promise<void> {
    const server = await this.settings.smtpServer();
    if (!server) {
      throw new BadRequestException('请先填写 SMTP 服务器和发件人地址');
    }
    const text = `这是一封测试邮件。\n\n收到它，说明 ${APP_NAME} 的邮件服务配置正确。`;
    try {
      await this.transport.send(server, {
        to,
        subject: `${APP_NAME} 测试邮件`,
        text,
        html: toHtml(text),
      });
    } catch (error) {
      throw new BadRequestException(
        `发送失败：${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

const LINK = /(https?:\/\/[^\s<>"']+)/;
const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => ESCAPES[char]!);
}

/** The plain text as a simple HTML page: escaped, with its line breaks and clickable links. */
export function toHtml(text: string): string {
  const body = text
    .split(LINK)
    .map((part, index) => {
      const escaped = escapeHtml(part);
      return index % 2 === 1
        ? `<a href="${escaped}" style="color:#2563eb">${escaped}</a>`
        : escaped;
    })
    .join('')
    .replace(/\r?\n/g, '<br>');
  return (
    '<!doctype html><html><body style="margin:0;padding:24px;background:#f4f4f5">' +
    '<div style="max-width:560px;margin:0 auto;padding:24px 28px;background:#ffffff;' +
    'border-radius:8px;color:#18181b;font-size:14px;line-height:1.7;word-break:break-all;' +
    "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC','Microsoft YaHei',sans-serif\">" +
    `${body}</div></body></html>`
  );
}
