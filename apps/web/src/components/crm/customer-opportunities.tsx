import { useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { Can } from '@/components/can';
import { OpportunityFormDialog } from '@/components/crm/opportunity-form-dialog';
import { OpportunityTable } from '@/components/crm/opportunity-table';
import { ErrorAlert } from '@/components/error-alert';
import { PaginationBar } from '@/components/pagination-bar';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { opportunitiesQuery } from '@/lib/crm';
import { PAGE_SIZE } from '@/lib/system';

/** The customer's opportunities on its page, the newest first. */
export function CustomerOpportunities({ customerId }: { customerId: string }) {
  const [page, setPage] = useState(1);
  const { data, error } = useQuery(opportunitiesQuery({ page, customerId }));
  const [creating, setCreating] = useState(false);

  return (
    <Card>
      <CardHeader>
        <CardTitle>商机</CardTitle>
        <CardAction>
          <Can code="crm:opportunity:create">
            <Button variant="outline" size="sm" onClick={() => setCreating(true)}>
              <Plus />
              新建
            </Button>
          </Can>
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-4">
        {error ? (
          <ErrorAlert error={error} />
        ) : (
          <OpportunityTable items={data?.items} emptyText="还没有商机" />
        )}
        {data && data.total > PAGE_SIZE && (
          <PaginationBar
            page={page}
            pageSize={PAGE_SIZE}
            total={data.total}
            onPageChange={setPage}
          />
        )}
      </CardContent>
      {creating && (
        <OpportunityFormDialog customerId={customerId} onClosed={() => setCreating(false)} />
      )}
    </Card>
  );
}
