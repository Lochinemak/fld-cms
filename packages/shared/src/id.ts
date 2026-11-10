import { z } from 'zod';

// Snowflake IDs are 64-bit; they travel as decimal strings because JS numbers lose precision above 2^53.
export const idSchema = z.string().regex(/^[1-9]\d{0,19}$/, 'Invalid id');

export type Id = z.infer<typeof idSchema>;
