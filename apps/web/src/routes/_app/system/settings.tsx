import { useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { ErrorAlert } from '@/components/error-alert';
import { PageHeader } from '@/components/page-header';
import { RequirePermission } from '@/components/require-permission';
import { LogtoSettingsCard } from '@/components/settings/logto-settings-card';
import { MailSettingsCard } from '@/components/settings/mail-settings-card';
import { MailStatus } from '@/components/settings/mail-status';
import { MailTemplateCard } from '@/components/settings/mail-template-card';
import { TestMailCard } from '@/components/settings/test-mail-card';
import { logtoSettingsQuery, mailTemplatesQuery, platformSettingsQuery } from '@/lib/platform';

export const Route = createFileRoute('/_app/system/settings')({
  component: () => (
    <RequirePermission code="system:settings">
      <SettingsPage />
    </RequirePermission>
  ),
});

function SettingsPage() {
  const settings = useQuery(platformSettingsQuery);
  const templates = useQuery(mailTemplatesQuery);
  const logto = useQuery(logtoSettingsQuery);
  const error = settings.error ?? templates.error ?? logto.error;

  return (
    <div className="max-w-3xl space-y-6">
      <PageHeader
        title="平台设置"
        description="系统名称、邮件服务、站点地址和 Logto 登录。除系统名称外，这里填的值优先于环境变量，留空就用环境变量的值。"
      />
      <ErrorAlert error={error} />
      {settings.isPending && <p className="text-sm text-muted-foreground">加载中…</p>}
      {settings.data && (
        <>
          <MailStatus ready={settings.data.mailReady} />
          <MailSettingsCard view={settings.data} />
          <TestMailCard />
        </>
      )}
      {templates.data?.map((template) => (
        <MailTemplateCard key={template.key} template={template} />
      ))}
      {logto.data && <LogtoSettingsCard view={logto.data} />}
    </div>
  );
}
