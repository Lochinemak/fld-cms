import { opportunityStageSchema, type OpportunityStage, type StageSummary } from '@fld/shared';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';
import { OpportunityTable } from '@/components/crm/opportunity-table';
import { PageHeader } from '@/components/page-header';
import { PaginationBar } from '@/components/pagination-bar';
import { RequirePermission } from '@/components/require-permission';
import { SearchBox } from '@/components/search-box';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { OPPORTUNITY_STAGE_LABELS, formatAmount, opportunitiesQuery } from '@/lib/crm';
import { PAGE_SIZE } from '@/lib/system';
import { cn } from '@/lib/utils';

const searchSchema = z.object({
  page: z.number().int().min(1).optional().catch(undefined),
  keyword: z.string().optional().catch(undefined),
  stage: opportunityStageSchema.optional().catch(undefined),
  mine: z.boolean().optional().catch(undefined),
});

export const Route = createFileRoute('/_app/crm/opportunities')({
  validateSearch: searchSchema,
  component: () => (
    <RequirePermission code="crm:opportunity">
      <OpportunitiesPage />
    </RequirePermission>
  ),
});

function OpportunitiesPage() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const page = search.page ?? 1;
  const { data, error } = useQuery(
    opportunitiesQuery({ page, keyword: search.keyword, stage: search.stage, mine: search.mine }),
  );

  // A new filter starts again from the first page.
  const filter = (patch: Partial<z.infer<typeof searchSchema>>) =>
    void navigate({ search: (prev) => ({ ...prev, ...patch, page: undefined }) });

  return (
    <div className="space-y-6">
      <PageHeader
        title="商机"
        description="只列出你的数据范围内的商机；点阶段只看该阶段。新建商机请到客户详情页。"
      />
      <StageSummaryBar
        stages={data?.stages}
        value={search.stage}
        onChange={(stage) => filter({ stage })}
      />
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <SearchBox
            value={search.keyword}
            placeholder="搜索商机或客户名称"
            onSearch={(keyword) => filter({ keyword })}
          />
          <Label className="font-normal">
            <Checkbox
              checked={search.mine ?? false}
              onCheckedChange={(checked) => filter({ mine: checked || undefined })}
            />
            只看我负责的
          </Label>
        </div>
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error.message}</AlertDescription>
          </Alert>
        )}
        <div className="rounded-lg border">
          <OpportunityTable
            items={error ? [] : data?.items}
            showCustomer
            emptyText="没有找到商机"
          />
        </div>
        <PaginationBar
          page={page}
          pageSize={PAGE_SIZE}
          total={data?.total ?? 0}
          onPageChange={(next) => void navigate({ search: (prev) => ({ ...prev, page: next }) })}
        />
      </div>
    </div>
  );
}

interface StageSummaryBarProps {
  /** Counts and amounts under the other filters, whichever stage is picked. */
  stages: readonly StageSummary[] | undefined;
  value: OpportunityStage | undefined;
  onChange: (stage: OpportunityStage | undefined) => void;
}

/** One button per stage; pressing one narrows the list to it, pressing it again shows all. */
function StageSummaryBar({ stages, value, onChange }: StageSummaryBarProps) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
      {opportunityStageSchema.options.map((stage) => {
        const summary = stages?.find((item) => item.stage === stage);
        const active = value === stage;
        return (
          <button
            key={stage}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(active ? undefined : stage)}
            className={cn(
              'rounded-lg border p-3 text-left transition-colors hover:bg-muted/60',
              active && 'border-primary bg-muted',
            )}
          >
            <div className="text-sm text-muted-foreground">{OPPORTUNITY_STAGE_LABELS[stage]}</div>
            <div className="mt-1 text-xl font-semibold tabular-nums">
              {summary ? summary.count : '—'}
            </div>
            <div className="text-xs text-muted-foreground tabular-nums">
              {summary ? `¥${formatAmount(summary.amount)}` : '\u00a0'}
            </div>
          </button>
        );
      })}
    </div>
  );
}
