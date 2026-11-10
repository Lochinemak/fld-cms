import { healthCheckSchema, type HealthCheck } from '@fld/shared';

// The endpoint answers 503 with the same body when a dependency is down, so the status code is not checked.
export async function fetchHealth(): Promise<HealthCheck> {
  const res = await fetch('/api/health', { headers: { Accept: 'application/json' } });
  return healthCheckSchema.parse(await res.json());
}
