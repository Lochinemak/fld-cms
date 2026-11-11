import type { PermissionCode } from '@fld/shared';
import { Link, useMatchRoute } from '@tanstack/react-router';
import {
  Building2,
  BookA,
  ContactRound,
  FolderOpen,
  Handshake,
  ListPlus,
  LayoutDashboard,
  MessagesSquare,
  Network,
  ScrollText,
  Settings,
  ShieldCheck,
  Store,
  UserCog,
  Users,
  type LucideIcon,
} from 'lucide-react';
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from '@/components/ui/sidebar';
import { hasPermission, useMe } from '@/lib/auth';
import { useAppName } from '@/lib/site';
import { useTranslation } from 'react-i18next';
import { permissionName } from '@/i18n';

interface MenuPage {
  to:
    | '/crm/customers'
    | '/crm/contacts'
    | '/crm/follow-ups'
    | '/crm/opportunities'
    | '/files'
    | '/system/tenants'
    | '/system/accounts'
    | '/system/settings'
    | '/system/members'
    | '/system/depts'
    | '/system/roles'
    | '/system/dictionaries'
    | '/system/custom-fields'
    | '/system/audit-logs';
  icon: LucideIcon;
  /** The permission that opens the page; its name in the registry titles the menu item. */
  code: PermissionCode;
}

interface MenuGroup {
  /** The directory whose name in the registry labels the group. */
  code: PermissionCode;
  pages: MenuPage[];
}

const MENU: MenuGroup[] = [
  {
    code: 'crm',
    pages: [
      { to: '/crm/customers', icon: Store, code: 'crm:customer' },
      { to: '/crm/contacts', icon: ContactRound, code: 'crm:contact' },
      { to: '/crm/follow-ups', icon: MessagesSquare, code: 'crm:follow-up' },
      { to: '/crm/opportunities', icon: Handshake, code: 'crm:opportunity' },
    ],
  },
  {
    code: 'file',
    pages: [{ to: '/files', icon: FolderOpen, code: 'file:library' }],
  },
  {
    code: 'system',
    pages: [
      { to: '/system/tenants', icon: Building2, code: 'system:tenant' },
      { to: '/system/accounts', icon: UserCog, code: 'system:account' },
      { to: '/system/settings', icon: Settings, code: 'system:settings' },
      { to: '/system/audit-logs', icon: ScrollText, code: 'system:platform-audit' },
      { to: '/system/members', icon: Users, code: 'system:member' },
      { to: '/system/depts', icon: Network, code: 'system:dept' },
      { to: '/system/roles', icon: ShieldCheck, code: 'system:role' },
      { to: '/system/dictionaries', icon: BookA, code: 'system:dictionary' },
      { to: '/system/custom-fields', icon: ListPlus, code: 'system:custom-field' },
      { to: '/system/audit-logs', icon: ScrollText, code: 'system:audit' },
    ],
  },
];

/** The menu lists only the pages the user may open in the current tenant. */
export function AppSidebar() {
  const { t } = useTranslation('layout');
  const me = useMe();
  const appName = useAppName();
  const matchRoute = useMatchRoute();

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" render={<Link to="/" />}>
              <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-sm font-semibold text-primary-foreground">
                {Array.from(appName)[0]}
              </span>
              <span className="font-semibold">{appName}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        {!me.tenant?.isSystem && (
          <SidebarGroup>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  isActive={!!matchRoute({ to: '/' })}
                  tooltip={t('workbench')}
                  render={<Link to="/" />}
                >
                  <LayoutDashboard />
                  <span>{t('workbench')}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroup>
        )}
        {MENU.map((group) => {
          const pages = group.pages.filter(({ code }) => hasPermission(me, code));
          if (pages.length === 0) {
            return null;
          }
          return (
            <SidebarGroup key={group.code}>
              <SidebarGroupLabel>{permissionName(group.code)}</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {pages.map(({ to, icon: Icon, code }) => {
                    const title = permissionName(code);
                    return (
                      <SidebarMenuItem key={code}>
                        <SidebarMenuButton
                          isActive={!!matchRoute({ to, fuzzy: true })}
                          tooltip={title}
                          render={<Link to={to} />}
                        >
                          <Icon />
                          <span>{title}</span>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    );
                  })}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          );
        })}
      </SidebarContent>
      <SidebarRail />
    </Sidebar>
  );
}
