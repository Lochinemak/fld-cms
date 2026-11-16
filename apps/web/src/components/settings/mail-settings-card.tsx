import {
  APP_NAME_MAX_LENGTH,
  DEFAULT_APP_NAME,
  updatePlatformSettingsSchema,
  type PlatformSettingsView,
  type SmtpSecurity,
} from '@fld/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { ErrorAlert } from '@/components/error-alert';
import { SelectField, type SelectOption } from '@/components/select-field';
import { TextField } from '@/components/text-field';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { useCan } from '@/lib/auth';
import { parseForm, type FieldErrors } from '@/lib/form';
import {
  blankHint,
  logtoSettingsQuery,
  mailTemplatesQuery,
  platformSettingsQuery,
  updatePlatformSettings,
} from '@/lib/platform';
import { refreshSite, useAppName } from '@/lib/site';

const SECURITY_OPTIONS: SelectOption<SmtpSecurity>[] = [
  { value: 'ssl', label: 'SSL/TLS（常用端口 465）' },
  { value: 'starttls', label: 'STARTTLS（常用端口 587）' },
  { value: 'none', label: '不加密（常用端口 25）' },
];

const SECURITY_LABELS = Object.fromEntries(
  SECURITY_OPTIONS.map((option) => [option.value, option.label]),
) as Record<SmtpSecurity, string>;

/** The SMTP server, the sender, the system name and the site address. */
export function MailSettingsCard({ view }: { view: PlatformSettingsView }) {
  const canUpdate = useCan('system:settings:update');
  const queryClient = useQueryClient();
  const appName = useAppName();
  const { page, env } = view;
  const [security, setSecurity] = useState<SmtpSecurity | null>(page.smtpSecurity);
  const [password, setPassword] = useState('');
  const [clearPassword, setClearPassword] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [saved, setSaved] = useState(false);
  const mutation = useMutation({
    mutationFn: updatePlatformSettings,
    onSuccess: (next) => {
      queryClient.setQueryData(platformSettingsQuery.queryKey, next);
      // Logto's callback address follows the site address.
      void queryClient.invalidateQueries({ queryKey: logtoSettingsQuery.queryKey });
      // Every page shows the name, and so do the previews of the mail templates.
      void refreshSite(queryClient);
      void queryClient.invalidateQueries({ queryKey: mailTemplatesQuery.queryKey });
      setPassword('');
      setClearPassword(false);
      setSaved(true);
    },
  });

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaved(false);
    const form = new FormData(event.currentTarget);
    const input = parseForm(
      updatePlatformSettingsSchema,
      {
        appName: form.get('appName'),
        smtpHost: form.get('smtpHost'),
        smtpPort: form.get('smtpPort'),
        smtpSecurity: security,
        smtpUsername: form.get('smtpUsername'),
        // Left blank, the saved password stays.
        smtpPassword: clearPassword ? null : password || undefined,
        mailFromAddress: form.get('mailFromAddress'),
        mailFromName: form.get('mailFromName'),
        siteUrl: form.get('siteUrl'),
      },
      setErrors,
    );
    if (input) {
      mutation.mutate(input);
    }
  }

  let passwordHint: string;
  if (!view.canStoreSecrets) {
    passwordHint =
      '没有配置 SETTINGS_ENCRYPTION_KEY，不能在页面上保存密码；可以改用环境变量 SMTP_PASSWORD。';
  } else if (page.smtpPassword) {
    passwordHint = '已保存（加密存放，不会显示）。留空则不修改。';
  } else if (env.smtpPassword) {
    passwordHint = '留空则用环境变量里的密码。';
  } else {
    passwordHint = '服务器不需要登录的话可以留空。';
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>邮件服务</CardTitle>
        <CardDescription>用来发「忘记密码」的重设链接和修改邮箱的确认邮件。</CardDescription>
      </CardHeader>
      <CardContent>
        <form id="mail-settings" onSubmit={onSubmit} noValidate className="space-y-4">
          <ErrorAlert error={mutation.error} />
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField
              name="smtpHost"
              label="SMTP 服务器"
              defaultValue={page.smtpHost ?? ''}
              placeholder="smtp.example.com"
              hint={blankHint(env.smtpHost)}
              error={errors['smtpHost']}
              disabled={!canUpdate}
            />
            <TextField
              name="smtpPort"
              label="端口"
              inputMode="numeric"
              defaultValue={page.smtpPort ?? ''}
              hint={blankHint(env.smtpPort, '留空则按加密方式用常用端口')}
              error={errors['smtpPort']}
              disabled={!canUpdate}
            />
            <SelectField
              id="smtpSecurity"
              label="加密方式"
              options={SECURITY_OPTIONS}
              value={security}
              onValueChange={setSecurity}
              emptyLabel={
                env.smtpSecurity
                  ? `用环境变量的值：${SECURITY_LABELS[env.smtpSecurity]}`
                  : '自动：465 端口用 SSL/TLS，其他用 STARTTLS'
              }
              error={errors['smtpSecurity']}
              disabled={!canUpdate}
            />
            <div className="hidden sm:block" />
            <TextField
              name="smtpUsername"
              label="用户名"
              autoComplete="off"
              defaultValue={page.smtpUsername ?? ''}
              hint={blankHint(env.smtpUsername)}
              error={errors['smtpUsername']}
              disabled={!canUpdate}
            />
            <div className="space-y-2">
              <TextField
                name="smtpPassword"
                label="密码"
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder={page.smtpPassword ? '••••••••' : undefined}
                hint={passwordHint}
                error={errors['smtpPassword']}
                disabled={!canUpdate || !view.canStoreSecrets || clearPassword}
              />
              {canUpdate && page.smtpPassword && (
                <Label className="font-normal">
                  <Checkbox
                    checked={clearPassword}
                    onCheckedChange={(checked) => setClearPassword(checked)}
                  />
                  {env.smtpPassword ? '清除已保存的密码，改用环境变量里的' : '清除已保存的密码'}
                </Label>
              )}
            </div>
            <TextField
              name="mailFromAddress"
              label="发件人地址"
              type="email"
              defaultValue={page.mailFromAddress ?? ''}
              placeholder="admin@example.com"
              hint={blankHint(env.mailFromAddress)}
              error={errors['mailFromAddress']}
              disabled={!canUpdate}
            />
            <TextField
              name="mailFromName"
              label="发件人名称"
              defaultValue={page.mailFromName ?? ''}
              placeholder={appName}
              hint={blankHint(env.mailFromName)}
              error={errors['mailFromName']}
              disabled={!canUpdate}
            />
          </div>
          <Separator />
          <TextField
            name="appName"
            label="系统名称"
            defaultValue={page.appName ?? ''}
            placeholder={DEFAULT_APP_NAME}
            maxLength={APP_NAME_MAX_LENGTH}
            hint={`显示在浏览器标签页、登录页、侧边栏和邮件里。留空则用默认名称 ${DEFAULT_APP_NAME}。`}
            error={errors['appName']}
            disabled={!canUpdate}
          />
          <TextField
            name="siteUrl"
            label="站点地址"
            type="url"
            defaultValue={page.siteUrl ?? ''}
            placeholder="https://admin.example.com"
            hint={blankHint(env.siteUrl, '用户在浏览器里打开系统的地址，邮件里的链接以它开头。')}
            error={errors['siteUrl']}
            disabled={!canUpdate}
          />
        </form>
      </CardContent>
      {canUpdate && (
        <CardFooter className="gap-3">
          <Button type="submit" form="mail-settings" disabled={mutation.isPending}>
            {mutation.isPending ? '保存中…' : '保存'}
          </Button>
          {saved && <span className="text-sm text-muted-foreground">已保存</span>}
        </CardFooter>
      )}
    </Card>
  );
}
