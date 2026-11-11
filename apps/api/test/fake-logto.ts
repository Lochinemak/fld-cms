import { createHash, generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

/** What Logto says of a user: the claims of its ID tokens and of its userinfo endpoint. */
export interface LogtoUser {
  sub: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
}

interface Grant {
  user: LogtoUser;
  clientId: string | null;
  redirectUri: string | null;
  nonce: string | null;
  challenge: string | null;
}

async function bodyOf(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString();
}

/** The client's id and secret, from the Authorization header or else the form. */
function credentialsOf(request: IncomingMessage, form: URLSearchParams): (string | null)[] {
  const [scheme, encoded] = (request.headers.authorization ?? '').split(' ');
  if (scheme !== 'Basic' || !encoded) {
    return [form.get('client_id'), form.get('client_secret')];
  }
  return Buffer.from(encoded, 'base64').toString().split(':').map(decodeURIComponent);
}

/**
 * A stand-in for Logto on this machine: the endpoints a sign-in calls, with ID tokens signed as
 * Logto signs them (ES384). `approve()` is the user signing in on Logto's page.
 */
export class FakeLogto {
  /** The application registered with it. */
  readonly app = { id: `app-${randomUUID()}`, secret: `secret-${randomUUID()}` };
  /** Its endpoint, which the settings take; its issuer is this with /oidc. */
  url = '';
  private readonly keys = generateKeyPairSync('ec', { namedCurve: 'P-384' });
  private readonly kid = randomUUID();
  private readonly grants = new Map<string, Grant>();
  private readonly accessTokens = new Map<string, LogtoUser>();
  private server: Server | undefined;

  get issuer(): string {
    return `${this.url}/oidc`;
  }

  async start(): Promise<void> {
    const server = createServer((request, response) => void this.answer(request, response));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    this.server = server;
    this.url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }

  async stop(): Promise<void> {
    await new Promise((resolve) => this.server?.close(resolve));
  }

  /**
   * The user signs in on the page the authorization URL leads to: the query Logto then sends
   * the browser back to the redirect URI with.
   */
  approve(authorizationUrl: string, user: LogtoUser): { code: string; state: string } {
    const params = new URL(authorizationUrl).searchParams;
    const code = randomUUID();
    this.grants.set(code, {
      user,
      clientId: params.get('client_id'),
      redirectUri: params.get('redirect_uri'),
      nonce: params.get('nonce'),
      challenge: params.get('code_challenge'),
    });
    return { code, state: params.get('state') ?? '' };
  }

  private async answer(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const send = (status: number, body: unknown) => {
      response.writeHead(status, { 'content-type': 'application/json' });
      response.end(JSON.stringify(body));
    };
    const { pathname } = new URL(request.url ?? '/', this.url);
    if (pathname === '/oidc/.well-known/openid-configuration') {
      send(200, {
        issuer: this.issuer,
        authorization_endpoint: `${this.issuer}/auth`,
        token_endpoint: `${this.issuer}/token`,
        userinfo_endpoint: `${this.issuer}/me`,
        jwks_uri: `${this.issuer}/jwks`,
        response_types_supported: ['code'],
        subject_types_supported: ['public'],
        id_token_signing_alg_values_supported: ['ES384'],
        code_challenge_methods_supported: ['S256'],
        token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post'],
      });
    } else if (pathname === '/oidc/jwks') {
      const key = this.keys.publicKey.export({ format: 'jwk' });
      send(200, { keys: [{ ...key, kid: this.kid, alg: 'ES384', use: 'sig' }] });
    } else if (pathname === '/oidc/token' && request.method === 'POST') {
      const form = new URLSearchParams(await bodyOf(request));
      const code = form.get('code') ?? '';
      const grant = this.grants.get(code);
      this.grants.delete(code);
      const [id, secret] = credentialsOf(request, form);
      const challenge = createHash('sha256')
        .update(form.get('code_verifier') ?? '')
        .digest('base64url');
      if (
        !grant ||
        id !== this.app.id ||
        secret !== this.app.secret ||
        grant.clientId !== id ||
        grant.redirectUri !== form.get('redirect_uri') ||
        grant.challenge !== challenge
      ) {
        send(400, { error: 'invalid_grant' });
        return;
      }
      const accessToken = randomUUID();
      this.accessTokens.set(accessToken, grant.user);
      send(200, {
        access_token: accessToken,
        token_type: 'Bearer',
        expires_in: 3600,
        id_token: this.idToken(grant),
      });
    } else if (pathname === '/oidc/me') {
      const [, accessToken = ''] = (request.headers.authorization ?? '').split(' ');
      const user = this.accessTokens.get(accessToken);
      send(user ? 200 : 401, user ?? { error: 'invalid_token' });
    } else {
      send(404, { error: 'not_found' });
    }
  }

  private idToken({ user, nonce }: Grant): string {
    const now = Math.floor(Date.now() / 1000);
    const part = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
    const header = part({ alg: 'ES384', typ: 'JWT', kid: this.kid });
    const claims = part({
      ...user,
      iss: this.issuer,
      aud: this.app.id,
      iat: now,
      exp: now + 3600,
      ...(nonce && { nonce }),
    });
    const signature = sign('sha384', Buffer.from(`${header}.${claims}`), {
      key: this.keys.privateKey,
      dsaEncoding: 'ieee-p1363',
    });
    return `${header}.${claims}.${signature.toString('base64url')}`;
  }
}
