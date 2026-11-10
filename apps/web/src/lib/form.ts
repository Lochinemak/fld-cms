import type { z } from 'zod';

export type FieldErrors = Partial<Record<string, string>>;

/** The first message for each top-level field of a failed validation. */
export function fieldErrors(error: z.ZodError): FieldErrors {
  const errors: FieldErrors = {};
  for (const issue of error.issues) {
    errors[String(issue.path[0] ?? '')] ??= issue.message;
  }
  return errors;
}

/** A same-site path to return to after signing in, never another origin. */
export function safeRedirect(target: string | undefined): string {
  // Browsers read "//host" and "/\host" as another origin.
  return target && /^\/(?![/\\])/.test(target) ? target : '/';
}
