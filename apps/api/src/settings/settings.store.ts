import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { SecretBox } from './secret-box.js';

/** What the settings page saved, by key, and the box that seals the secrets among it. */
@Injectable()
export class SettingsStore {
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
}
