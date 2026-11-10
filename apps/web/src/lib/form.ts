import type { z } from 'zod';

export type FieldErrors = Partial<Record<string, string>>;

/** The first message for each field of a failed validation, keyed by its path: `admin.username`. */
export function fieldErrors(error: z.ZodError): FieldErrors {
  const errors: FieldErrors = {};
  for (const issue of error.issues) {
    errors[issue.path.map(String).join('.')] ??= issue.message;
  }
  return errors;
}

/** A form value that may be left empty: empty reads as not given. */
export function optionalText(value: FormDataEntryValue | null): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

/** A same-site path to return to after signing in, never another origin. */
export function safeRedirect(target: string | undefined): string {
  // Browsers read "//host" and "/\host" as another origin.
  return target && /^\/(?![/\\])/.test(target) ? target : '/';
}
