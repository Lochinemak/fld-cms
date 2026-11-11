import {
  APP_NAME,
  EMAIL_CHANGE_MINUTES,
  PASSWORD_RESET_MINUTES,
  type MailTemplateKey,
} from '@fld/shared';

export interface MailTemplateDefinition {
  name: string;
  subject: string;
  body: string;
  placeholders: { name: string; description: string; example: string }[];
}

/** The built-in templates, which the settings page may change and restore. */
export const MAIL_TEMPLATES: Record<MailTemplateKey, MailTemplateDefinition> = {
  'password-reset': {
    name: '重置密码',
    subject: `重设你的 ${APP_NAME} 密码`,
    body: [
      '{{姓名}}，你好：',
      '',
      '我们收到了重设账号 {{用户名}} 密码的请求。请在 {{有效分钟}} 分钟内打开下面的链接，设置新密码：',
      '',
      '{{重设链接}}',
      '',
      '如果不是你本人操作，请忽略这封邮件，你的密码不会改变。',
    ].join('\n'),
    placeholders: [
      { name: '姓名', description: '账号的姓名', example: '张三' },
      { name: '用户名', description: '登录用的用户名', example: 'zhangsan' },
      {
        name: '重设链接',
        description: '打开后设置新密码的链接，只能用一次',
        example: 'https://admin.example.com/reset-password?token=…',
      },
      {
        name: '有效分钟',
        description: '链接多少分钟内有效',
        example: String(PASSWORD_RESET_MINUTES),
      },
    ],
  },
  'email-change': {
    name: '修改邮箱确认',
    subject: `确认你的 ${APP_NAME} 新邮箱`,
    body: [
      '{{姓名}}，你好：',
      '',
      '账号 {{用户名}} 申请把邮箱改为 {{新邮箱}}。请在 {{有效分钟}} 分钟内打开下面的链接，点击「确认修改邮箱」，修改才会生效：',
      '',
      '{{确认链接}}',
      '',
      '如果不是你本人操作，请忽略这封邮件，账号的邮箱不会改变。',
    ].join('\n'),
    placeholders: [
      { name: '姓名', description: '账号的姓名', example: '张三' },
      { name: '用户名', description: '登录用的用户名', example: 'zhangsan' },
      {
        name: '新邮箱',
        description: '要改成的邮箱，也就是这封邮件的收件地址',
        example: 'zhangsan@example.com',
      },
      {
        name: '确认链接',
        description: '打开后确认修改邮箱的链接，只能用一次',
        example: 'https://admin.example.com/confirm-email?token=…',
      },
      {
        name: '有效分钟',
        description: '链接多少分钟内有效',
        example: String(EMAIL_CHANGE_MINUTES),
      },
    ],
  },
};
