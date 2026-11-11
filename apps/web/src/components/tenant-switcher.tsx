import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Building2, ChevronsUpDown } from 'lucide-react';
import { buttonVariants } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { meQuery, switchTenant, useMe } from '@/lib/auth';
import { useTranslation } from 'react-i18next';

export function TenantSwitcher() {
  const { t } = useTranslation('layout');
  const me = useMe();
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: switchTenant,
    // A full reload, so nothing of the previous tenant stays in memory.
    onSuccess: () => window.location.assign('/'),
    // The tenant may have been disabled or the membership removed meanwhile.
    onError: () => queryClient.invalidateQueries({ queryKey: meQuery.queryKey }),
  });

  if (me.tenants.length === 0) {
    return <span className="text-sm text-muted-foreground">{t('noTenant')}</span>;
  }

  return (
    <div className="flex min-w-0 items-center gap-2">
      <DropdownMenu>
        <DropdownMenuTrigger
          className={buttonVariants({ variant: 'ghost', size: 'sm' })}
          disabled={mutation.isPending}
        >
          <Building2 />
          <span className="truncate">{me.tenant?.name ?? t('chooseTenant')}</span>
          <ChevronsUpDown className="opacity-50" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-56">
          <DropdownMenuGroup>
            <DropdownMenuLabel>{t('switchTenant')}</DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={me.tenant?.id ?? ''}
              onValueChange={(tenantId: string) => {
                if (tenantId !== me.tenant?.id) {
                  mutation.mutate(tenantId);
                }
              }}
            >
              {me.tenants.map((tenant) => (
                <DropdownMenuRadioItem key={tenant.id} value={tenant.id}>
                  <span className="truncate">{tenant.name}</span>
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      {mutation.error && (
        <span className="truncate text-xs text-destructive">{mutation.error.message}</span>
      )}
    </div>
  );
}
