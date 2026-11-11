import { APP_NAME, permissionDefinition, type PermissionCode } from '@fld/shared';
import { Link, useMatchRoute } from '@tanstack/react-router';
import {
  Building2,
  ContactRound,
  FolderOpen,
  Handshake,
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
      { to: '/system/audit-logs', icon: ScrollText, code: 'system:audit' },
    ],
  },
];

/** The menu lists only the pages the user may open in the current tenant. */
export function AppSidebar() {
  const me = useMe();
  const matchRoute = useMatchRoute();

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" render={<Link to="/" />}>
              <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-sm font-semibold text-primary-foreground">
                {APP_NAME.charAt(0)}
              </span>
              <span className="font-semibold">{APP_NAME}</span>
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
                  tooltip="工作台"
                  render={<Link to="/" />}
                >
                  <LayoutDashboard />
                  <span>工作台</span>
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
              <SidebarGroupLabel>{permissionDefinition(group.code).name}</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {pages.map(({ to, icon: Icon, code }) => {
                    const title = permissionDefinition(code).name;
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
