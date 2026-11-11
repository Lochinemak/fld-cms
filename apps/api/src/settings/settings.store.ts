import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { SecretBox } from './secret-box.js';

/** A secret the settings page keeps, sealed under its key. */
export interface SecretSetting {
  key: string;
  /** What the page calls it: 密码, 应用密钥. */
  label: string;
  /** The environment variable to use instead when the page cannot store it. */
  envVar: string;
}

/**
 * What changed about a secret, for the audit log, never the secret itself: replaced, cleared or
 * nothing.
 */
export function secretChange(
  input: string | null | undefined,
  storedBefore: boolean,
  storedAfter: boolean,
): string | null {
  return input ? '已更换' : storedBefore && !storedAfter ? '已清除' : null;
}

/** What the settings page saved, by key, and the box that seals the secrets among it. */
@Injectable()
export class SettingsStore {
  private readonly logger = new Logger(SettingsStore.name);
  /** Null without SETTINGS_ENCRYPTION_KEY: the page then can't save secrets. */
  readonly box: SecretBox | null;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService<Env, true>,
  ) {
    const key = config.get('SETTINGS_ENCRYPTION_KEY', { infer: true });
    this.box = key ? new SecretBox(Buffer.from(key, 'base64')) : null;
  }

  async read(keys: string[]): Promise<Map<string, string>> {
    const rows = await this.prisma.platformSetting.findMany({ where: { key: { in: keys } } });
    return new Map(rows.map((row) => [row.key, row.value]));
  }

  /** Stores each value, or deletes it for null. */
  async write(values: [string, string | null][]): Promise<void> {
    await this.prisma.$transaction(
      values.map(([key, value]) =>
        value === null
          ? this.prisma.platformSetting.deleteMany({ where: { key } })
          : this.prisma.platformSetting.upsert({
              where: { key },
              create: { key, value },
              update: { value },
            }),
      ),
    );
  }

  /**
   * The write for a secret the page sent: sealed for a new one, null for an empty one, which
   * clears it, and none when it was left out.
   */
  sealSecret(secret: SecretSetting, value: string | null | undefined): [string, string | null][] {
    if (value === undefined) {
      return [];
    }
    if (!value) {
      return [[secret.key, null]];
    }
    if (!this.box) {
      throw new BadRequestException(
        `没有配置 SETTINGS_ENCRYPTION_KEY，不能在页面上保存${secret.label}；可以改用环境变量 ${secret.envVar}`,
      );
    }
    return [[secret.key, this.box.seal(secret.key, value)]];
  }

  /**
   * The secret saved on the page, or null. One that no longer opens (the key changed) counts as
   * unset, to be entered again.
   */
  openSecret(secret: SecretSetting, rows: Map<string, string>): string | null {
    const sealed = rows.get(secret.key);
    if (sealed === undefined) {
      return null;
    }
    const opened = this.box?.open(secret.key, sealed) ?? null;
    if (opened === null) {
      this.logger.warn(
        `The setting ${secret.key} does not decrypt with SETTINGS_ENCRYPTION_KEY: save it again`,
      );
    }
    return opened;
  }
}
