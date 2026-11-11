import { LOGTO_SIGN_IN_ERRORS, type LogtoSignInError } from '@fld/shared';
import {
  BadGatewayException,
  Controller,
  Get,
  HttpException,
  Logger,
  NotFoundException,
  Query,
  Redirect,
} from '@nestjs/common';
import { OidcService, Public } from '@nestjs/authentication';
import { ApiTags } from '@nestjs/swagger';
import { AuditService } from '../audit/audit.service.js';
import { AccountRoute } from '../authz/account-route.decorator.js';
import { AccountService } from './account.service.js';
import { LOGTO, logtoAttempts, LogtoRefusedException, type LogtoAttempt } from './logto.js';

/** The sign-in page, saying why the sign-in with Logto didn't go through. */
const signInPage = (error: LogtoSignInError) => ({ url: `/login?error=${error}` });

/**
 * Signing in with Logto. Browsers are sent to both routes rather than calling them, so a failure
 * goes back to the sign-in page with its reason instead of answering with an error.
 */
@ApiTags('auth')
@AccountRoute()
@Public()
@Controller('auth/oidc/logto')
export class LogtoController {
  private readonly logger = new Logger(LogtoController.name);

  constructor(
    private readonly oidc: OidcService,
    private readonly accounts: AccountService,
    private readonly audit: AuditService,
  ) {}

  /** Sends the browser to Logto, which sends it to the callback once the user has signed in. */
  @Get('login')
  @Redirect()
  async login(@Query('redirect') redirect?: string): Promise<{ url: string }> {
    try {
      const { url } = await this.oidc.start(LOGTO, { redirectTo: redirect });
      return { url };
    } catch (error) {
      return signInPage(this.errorOf(error));
    }
  }

  /** Signs in the account of whoever Logto sends back, in the tenant it used last. */
  @Get('callback')
  @Redirect()
  async callback(@Query() query: Record<string, unknown>): Promise<{ url: string }> {
    const attempt: LogtoAttempt = { actor: null };
    let url: string;
    try {
      ({ url } = await logtoAttempts.run(attempt, () => this.oidc.finish(LOGTO, query)));
    } catch (error) {
      const reason = query['error'] === 'access_denied' ? 'cancelled' : this.errorOf(error);
      // While it is off, nothing was attempted.
      if (reason !== 'off') {
        await this.audit.record({
          action: 'auth.sign-in-logto',
          account: attempt.actor,
          success: false,
          reason: LOGTO_SIGN_IN_ERRORS[reason],
        });
      }
      return signInPage(reason);
    }
    const account = attempt.actor;
    if (account?.id != null) {
      await this.accounts.recordSignIn(account.id.toString());
    }
    await this.audit.record({ action: 'auth.sign-in-logto', account });
    return { url };
  }

  private errorOf(error: unknown): LogtoSignInError {
    if (error instanceof LogtoRefusedException) {
      return error.refusal;
    }
    if (error instanceof NotFoundException) {
      return 'off';
    }
    if (error instanceof BadGatewayException) {
      return 'unavailable';
    }
    if (!(error instanceof HttpException)) {
      this.logger.error(error);
    }
    return 'failed';
  }
}
