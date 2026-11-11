import 'i18next';
import type { zhCN } from './locales/zh-CN';

// Keys passed to t() are checked against the Chinese strings.
declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'common';
    resources: typeof zhCN;
  }
}
