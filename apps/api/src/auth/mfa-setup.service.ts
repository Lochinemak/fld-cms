import type { MfaSetup, MfaStatus, RecoveryCodes } from '@fld/shared';
import { BadRequestException, Injectable } from '@nestjs/common';
import { MfaService, SignInService } from '@nestjs/authentication';
import { ConfigService } from '@nestjs/config';
import { AuditService } from '../audit/audit.service.js';
import type { Env } from '../config/env.js';
import { PlatformSettingsService } from '../settings/platform-settings.service.js';
import { CredentialsService } from './credentials.service.js';
import type { Principal } from './principal.js';

/**
 * Each account's own two-step sign-in: setting the authenticator app up, its recovery codes, and
 * turning it off. Signing in with it is SignInService's `completeMfa()`.
 */
@Injectable()
export class MfaSetupService {
  /** MFA is configured only with a key to seal the secrets with (see app.module.ts). */
  readonly available: boolean;

  constructor(
    private readonly mfa: MfaService,
    private readonly signIn: SignInService,
    private readonly credentials: CredentialsService,
    private readonly settings: PlatformSettingsService,
    private readonly audit: AuditService,
    config: ConfigService<Env, true>,
  ) {
    this.available = !!config.get('SETTINGS_ENCRYPTION_KEY', { infer: true });
  }

  async status(userId: string): Promise<MfaStatus> {
    if (!this.available) {
      return { available: false, enabled: false, recoveryCodesLeft: 0 };
    }
    const [enabled, recoveryCodesLeft] = await Promise.all([
      this.mfa.isEnrolled(userId),
      this.mfa.remainingRecoveryCodes(userId),
    ]);
    return { available: true, enabled, recoveryCodesLeft };
  }

  /**
   * A new secret for the authenticator app, which the account takes once `confirm()` gets a code
   * from it. Takes the password: a borrowed browser must not tie the account to someone's phone.
   */
  async start(user: Principal, currentPassword: string): Promise<MfaSetup> {
    this.requireAvailable();
    await this.requirePassword(user, currentPassword);
    if (await this.mfa.isEnrolled(user.id)) {
      throw new BadRequestException('两步验证已经开启。要换手机，先关闭再重新开启');
    }
    const { secret } = await this.mfa.enroll(user.id, user.username);
    // The issuer as the product is named now, not when the API started.
    const issuer = await this.settings.appName();
    const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(user.username)}`;
    const params = new URLSearchParams({
      secret,
      issuer,
      algorithm: 'SHA1',
      digits: '6',
      period: '30',
    });
    return { secret, uri: `otpauth://totp/${label}?${params}` };
  }

  /**
   * Turns two-step sign-in on with a code from the app just set up, which also counts as this
   * browser's second step. Returns the recovery codes, shown this once.
   */
  async confirm(user: Principal, code: string): Promise<RecoveryCodes> {
    this.requireAvailable();
    if (!(await this.signIn.confirmMfa(user.id, code))) {
      throw new BadRequestException('验证码不正确，请看验证器里当前的 6 位数字');
    }
    const recoveryCodes = await this.mfa.generateRecoveryCodes(user.id);
    await this.audit.record({ action: 'auth.enable-mfa', account: user });
    return { recoveryCodes };
  }

  /** New recovery codes in place of the old ones. Routes calling it require the second step. */
  async renewRecoveryCodes(user: Principal): Promise<RecoveryCodes> {
    this.requireAvailable();
    const recoveryCodes = await this.mfa.generateRecoveryCodes(user.id);
    await this.audit.record({ action: 'auth.renew-recovery-codes', account: user });
    return { recoveryCodes };
  }

  /** Turns it off, with the password. Routes calling it require the second step. */
  async disable(user: Principal, currentPassword: string): Promise<void> {
    this.requireAvailable();
    await this.requirePassword(user, currentPassword);
    await this.mfa.disable(user.id);
    await this.audit.record({ action: 'auth.disable-mfa', account: user });
  }

  /**
   * For an administrator, when someone lost their phone and recovery codes: turns it off, so the
   * password alone signs in again. Whether it was on.
   */
  async reset(userId: string): Promise<boolean> {
    if (!this.available || !(await this.mfa.isEnrolled(userId))) {
      return false;
    }
    await this.mfa.disable(userId);
    return true;
  }

  isEnrolled(userId: string): Promise<boolean> {
    return this.available ? this.mfa.isEnrolled(userId) : Promise.resolve(false);
  }

  private requireAvailable(): void {
    if (!this.available) {
      throw new BadRequestException('服务器没有配置 SETTINGS_ENCRYPTION_KEY，不能开启两步验证');
    }
  }

  private async requirePassword(user: Principal, password: string): Promise<void> {
    if (!(await this.credentials.check(BigInt(user.id), password))) {
      throw new BadRequestException('当前密码不正确');
    }
  }
}
