import type { HealthCheck } from '@fld/shared';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { fetchHealth } from '@/lib/health';

type Status = 'up' | 'down' | 'pending' | 'unknown';

const STATUS_BADGE: Record<
  Status,
  { text: string; variant: 'secondary' | 'destructive' | 'outline' }
> = {
  up: { text: '正常', variant: 'secondary' },
  down: { text: '异常', variant: 'destructive' },
  pending: { text: '检查中', variant: 'outline' },
  unknown: { text: '未知', variant: 'outline' },
};

const DEPENDENCIES = [
  { key: 'database', label: 'PostgreSQL' },
  { key: 'redis', label: 'Redis' },
] as const;

function apiStatus(query: UseQueryResult<HealthCheck>): Status {
  if (query.isPending) return 'pending';
  return query.isError ? 'down' : 'up';
}

function dependencyStatus(query: UseQueryResult<HealthCheck>, key: string): Status {
  if (query.isPending) return 'pending';
  if (query.isError) return 'unknown';
  return query.data.details[key]?.status === 'up' ? 'up' : 'down';
}

export function ServiceStatusCard({ className }: { className?: string }) {
  const health = useQuery({ queryKey: ['health'], queryFn: fetchHealth, refetchInterval: 10_000 });

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>服务状态</CardTitle>
        <CardDescription>每 10 秒检查一次后端及其依赖</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <StatusRow label="后端 API" status={apiStatus(health)} />
        {DEPENDENCIES.map(({ key, label }) => (
          <StatusRow key={key} label={label} status={dependencyStatus(health, key)} />
        ))}
      </CardContent>
    </Card>
  );
}

function StatusRow({ label, status }: { label: string; status: Status }) {
  const badge = STATUS_BADGE[status];
  return (
    <div className="flex items-center justify-between text-sm">
      <span>{label}</span>
      <Badge variant={badge.variant}>{badge.text}</Badge>
    </div>
  );
}
