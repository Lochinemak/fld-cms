import { z } from 'zod';

const healthIndicatorSchema = z.looseObject({ status: z.enum(['up', 'degraded', 'down']) });

export const healthCheckSchema = z.object({
  status: z.enum(['ok', 'degraded', 'error', 'shutting_down']),
  info: z.record(z.string(), healthIndicatorSchema).optional(),
  error: z.record(z.string(), healthIndicatorSchema).optional(),
  details: z.record(z.string(), healthIndicatorSchema),
});

export type HealthCheck = z.infer<typeof healthCheckSchema>;
