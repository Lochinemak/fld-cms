import type {
  AuditChange,
  LogtoSettings,
  LogtoSettingsView,
  UpdateLogtoSettingsInput,
} from '@fld/shared';
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { changesOf } from '../audit/audit.service.js';
import type { Env } from '../config/env.js';
import { SITE_URL_KEY } from './platform-settings.service.js';
import { SettingsStore } from './settings.store.js';

const KEYS = { enabled: 'logto.enabled', url: 'logto.url', appId: 'logto.app-id' } as const;
const SECRET_KEY = 'logto.app-secret';

/** The route Logto sends the browser back to, under the site address. */
export const LOGTO_CALLBACK_PATH = '/api/auth/oidc/logto/callback';

/** The Logto application users sign in through. */
export interface LogtoApp {
  /** Logto's OIDC issuer: its endpoint, ending in /oidc. */
  issuer: string;
  appId: string;
  appSecret: string;
  /** The redirect URI registered with the application. */
  callbackUrl: string;
}

interface PageSettings {
  enabled: boolean;
  settings: LogtoSettings;
  secret: string | null;
  siteUrl: string | null;
}

/**
 * Signing in with Logto, as the settings page and the environment set it. Each value set on the
 * page overrides its variable (LOGTO_AUTH_URL, LOGTO_APP_ID, LOGTO_APP_SECRET), and the page's
 * app secret is stored encrypted. The authentication module asks this service how to reach Logto
 * while it starts, so it depends on nothing that module provides.
 */
@Injectable()
export class LogtoSettingsService {
  private readonly logger = new Logger(LogtoSettingsService.name);
  private readonly env: LogtoSettings;
  private readonly envSecret: string | null;
  private readonly envSiteUrl: string | null;

  constructor(
    private readonly store: SettingsStore,
    config: ConfigService<Env, true>,
  ) {
    this.envSecret = config.get('LOGTO_APP_SECRET', { infer: true }) ?? null;
    this.envSiteUrl = config.get('SITE_URL', { infer: true }) ?? null;
    this.env = {
      url: config.get('LOGTO_AUTH_URL', { infer: true }) ?? null,
      appId: config.get('LOGTO_APP_ID', { infer: true }) ?? null,
      appSecret: this.envSecret !== null,
    };
  }

  async view(): Promise<LogtoSettingsView> {
    const page = await this.page();
    return {
      enabled: page.enabled,
      page: page.settings,
      env: this.env,
      callbackUrl: page.siteUrl && `${page.siteUrl}${LOGTO_CALLBACK_PATH}`,
      ready: this.appOf(page) !== null,
      canStoreSecrets: this.store.box !== null,
    };
  }

  /**
   * The application to sign in through, or null while Logto sign-in is off or lacks Logto's
   * address, the application, its secret or the site address.
   */
  async app(): Promise<LogtoApp | null> {
    return this.appOf(await this.page());
  }

  /** Saves what the page set, and says what changed in the words of the audit log. */
  async update(
    input: UpdateLogtoSettingsInput,
  ): Promise<{ view: LogtoSettingsView; changes: AuditChange[] }> {
    const values: [string, string | null][] = [
      // On is what an unset switch means, so only off is stored.
      [KEYS.enabled, input.enabled ? null : 'false'],
      [KEYS.url, input.url],
      [KEYS.appId, input.appId],
    ];
    if (input.appSecret) {
      if (!this.store.box) {
        throw new BadRequestException(
          '没有配置 SETTINGS_ENCRYPTION_KEY，不能在页面上保存应用密钥；可以改用环境变量 LOGTO_APP_SECRET',
        );
      }
      values.push([SECRET_KEY, this.store.box.seal(SECRET_KEY, input.appSecret)]);
    } else if (input.appSecret !== undefined) {
      values.push([SECRET_KEY, null]);
    }
    const before = await this.view();
    await this.store.write(values);
    const view = await this.view();
    const state = (enabled: boolean) => (enabled ? '已启用' : '已停用');
    // Never the secret itself.
    const cleared = before.page.appSecret && !view.page.appSecret;
    const secret = input.appSecret ? '已更换' : cleared ? '已清除' : null;
    const changes = changesOf([
      ['Logto 登录', state(before.enabled), state(view.enabled)],
      ['Logto 地址', before.page.url, view.page.url],
      ['应用 ID', before.page.appId, view.page.appId],
      ['应用密钥', null, secret],
    ]);
    return { view, changes };
  }

  private async page(): Promise<PageSettings> {
    const rows = await this.store.read([...Object.values(KEYS), SECRET_KEY, SITE_URL_KEY]);
    const sealed = rows.get(SECRET_KEY);
    const secret = sealed === undefined ? null : this.open(sealed);
    return {
      enabled: rows.get(KEYS.enabled) !== 'false',
      settings: {
        url: rows.get(KEYS.url) ?? null,
        appId: rows.get(KEYS.appId) ?? null,
        // A secret that no longer opens (the key changed) shows as unset, to be entered again.
        appSecret: secret !== null,
      },
      secret,
      siteUrl: rows.get(SITE_URL_KEY) ?? this.envSiteUrl,
    };
  }

  private open(sealed: string): string | null {
    const secret = this.store.box?.open(SECRET_KEY, sealed) ?? null;
    if (secret === null) {
      this.logger.warn(
        'The Logto app secret saved on the settings page does not decrypt with SETTINGS_ENCRYPTION_KEY: save it again',
      );
    }
    return secret;
  }

  private appOf({ enabled, settings, secret, siteUrl }: PageSettings): LogtoApp | null {
    const url = settings.url ?? this.env.url;
    const appId = settings.appId ?? this.env.appId;
    const appSecret = secret ?? this.envSecret;
    if (!enabled || !url || !appId || !appSecret || !siteUrl) {
      return null;
    }
    return {
      // Either Logto's endpoint or its issuer may be given: the issuer is the endpoint with /oidc.
      issuer: url.endsWith('/oidc') ? url : `${url}/oidc`,
      appId,
      appSecret,
      callbackUrl: `${siteUrl}${LOGTO_CALLBACK_PATH}`,
    };
  }
}
