import { permissionDefinition, type PermissionCode } from '@fld/shared';
import { Link, useMatchRoute } from '@tanstack/react-router';
import {
  Building2,
  LayoutDashboard,
  Network,
  ShieldCheck,
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

interface SystemPage {
  to: '/system/tenants' | '/system/members' | '/system/depts' | '/system/roles';
  icon: LucideIcon;
  /** The permission that opens the page; its name in the registry titles the menu item. */
  code: PermissionCode;
}

const SYSTEM_PAGES: SystemPage[] = [
  { to: '/system/tenants', icon: Building2, code: 'system:tenant' },
  { to: '/system/members', icon: Users, code: 'system:member' },
  { to: '/system/depts', icon: Network, code: 'system:dept' },
  { to: '/system/roles', icon: ShieldCheck, code: 'system:role' },
];

/** The menu lists only the pages the user may open in the current tenant. */
export function AppSidebar() {
  const me = useMe();
  const matchRoute = useMatchRoute();
  const systemPages = SYSTEM_PAGES.filter(({ code }) => hasPermission(me, code));

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" render={<Link to="/" />}>
              <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-sm font-semibold text-primary-foreground">
                F
              </span>
              <span className="font-semibold">FLD CRM</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
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
        {systemPages.length > 0 && (
          <SidebarGroup>
            <SidebarGroupLabel>{permissionDefinition('system').name}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {systemPages.map(({ to, icon: Icon, code }) => {
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
        )}
      </SidebarContent>
      <SidebarRail />
    </Sidebar>
  );
}
