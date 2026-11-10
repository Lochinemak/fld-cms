/** Usernames and emails are stored lowercase, so either one matches however it was typed. */
export function normalizeAccount(account: string): string {
  return account.trim().normalize('NFC').toLowerCase();
}

/**
 * The username or email the request body names, normalized, or `''`. Rate limiting runs before
 * validation, so the body may hold anything.
 */
export function accountOf(req: { body?: { account?: unknown } }): string {
  const account = req.body?.account;
  return typeof account === 'string' ? normalizeAccount(account) : '';
}
