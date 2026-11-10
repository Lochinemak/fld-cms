import {
  renderMailTemplate,
  testMailSchema,
  updateMailTemplateSchema,
  updatePlatformSettingsSchema,
  type MailTemplate,
  type MailTemplateKey,
  type PlatformSettingsView,
  type SmtpSecurity,
  type UpdateMailTemplateInput,
} from '@fld/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { CircleAlert, CircleCheck } from 'lucide-react';
import { useRef, useState, type FormEvent } from 'react';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { PageHeader } from '@/components/page-header';
import { RequirePermission } from '@/components/require-permission';
import { SelectField, type SelectOption } from '@/components/select-field';
import { TextField } from '@/components/text-field';
import { TextareaField } from '@/components/textarea-field';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
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
import { useCan, useMe } from '@/lib/auth';
import { parseForm, type FieldErrors } from '@/lib/form';
import {
  mailTemplatesQuery,
  platformSettingsQuery,
  resetMailTemplate,
  sendTestMail,
  updateMailTemplate,
  updatePlatformSettings,
} from '@/lib/platform';

export const Route = createFileRoute('/_app/system/settings')({
  component: () => (
    <RequirePermission code="system:settings">
      <SettingsPage />
    </RequirePermission>
  ),
});

const SECURITY_OPTIONS: SelectOption<SmtpSecurity>[] = [
  { value: 'ssl', label: 'SSL/TLS（常用端口 465）' },
  { value: 'starttls', label: 'STARTTLS（常用端口 587）' },
  { value: 'none', label: '不加密（常用端口 25）' },
];

const SECURITY_LABELS = Object.fromEntries(
  SECURITY_OPTIONS.map((option) => [option.value, option.label]),
) as Record<SmtpSecurity, string>;

/** The placeholder a template is useless without. */
const REQUIRED_PLACEHOLDERS: Partial<Record<MailTemplateKey, string>> = {
  'password-reset': '重设链接',
};

function SettingsPage() {
  const settings = useQuery(platformSettingsQuery);
  const templates = useQuery(mailTemplatesQuery);
  const error = settings.error ?? templates.error;

  return (
    <div className="max-w-3xl space-y-6">
      <PageHeader
        title="平台设置"
        description="邮件服务和站点地址。这里填的值优先于环境变量，留空就用环境变量的值。"
      />
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error.message}</AlertDescription>
        </Alert>
      )}
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
    </div>
  );
}

function MailStatus({ ready }: { ready: boolean }) {
  return ready ? (
    <Alert>
      <CircleCheck />
      <AlertTitle>邮件服务已就绪</AlertTitle>
      <AlertDescription>用户可以用「忘记密码」通过邮件重设密码。</AlertDescription>
    </Alert>
  ) : (
    <Alert>
      <CircleAlert />
      <AlertTitle>邮件服务还没配好</AlertTitle>
      <AlertDescription>
        填好 SMTP
        服务器、发件人地址和站点地址之后，用户才能用「忘记密码」；在这之前，忘记密码只能请管理员重置。
      </AlertDescription>
    </Alert>
  );
}

/** Under a field: what applies while it is left blank. */
function blankHint(envValue: string | number | null, otherwise?: string): string | undefined {
  return envValue === null ? otherwise : `留空则用环境变量的值：${envValue}`;
}

function MailSettingsCard({ view }: { view: PlatformSettingsView }) {
  const canUpdate = useCan('system:settings:update');
  const queryClient = useQueryClient();
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
        <CardDescription>用来发「忘记密码」的重设链接。</CardDescription>
      </CardHeader>
      <CardContent>
        <form id="mail-settings" onSubmit={onSubmit} noValidate className="space-y-4">
          {mutation.error && (
            <Alert variant="destructive">
              <AlertDescription>{mutation.error.message}</AlertDescription>
            </Alert>
          )}
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
              placeholder="crm@example.com"
              hint={blankHint(env.mailFromAddress)}
              error={errors['mailFromAddress']}
              disabled={!canUpdate}
            />
            <TextField
              name="mailFromName"
              label="发件人名称"
              defaultValue={page.mailFromName ?? ''}
              placeholder="FLD CRM"
              hint={blankHint(env.mailFromName)}
              error={errors['mailFromName']}
              disabled={!canUpdate}
            />
          </div>
          <Separator />
          <TextField
            name="siteUrl"
            label="站点地址"
            type="url"
            defaultValue={page.siteUrl ?? ''}
            placeholder="https://crm.example.com"
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

function TestMailCard() {
  const me = useMe();
  const canUpdate = useCan('system:settings:update');
  const [errors, setErrors] = useState<FieldErrors>({});
  const mutation = useMutation({ mutationFn: sendTestMail });

  if (!canUpdate) {
    return null;
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const input = parseForm(testMailSchema, { to: form.get('to') }, setErrors);
    if (input) {
      mutation.mutate(input);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>发送测试邮件</CardTitle>
        <CardDescription>用已保存的设置发一封邮件，确认能收到。改了设置要先保存。</CardDescription>
      </CardHeader>
      <CardContent>
        <form id="test-mail" onSubmit={onSubmit} noValidate className="space-y-4">
          <TextField
            name="to"
            label="收件邮箱"
            type="email"
            defaultValue={me.user.email ?? ''}
            error={errors['to']}
          />
          {mutation.error && (
            <Alert variant="destructive">
              <AlertDescription>{mutation.error.message}</AlertDescription>
            </Alert>
          )}
          {mutation.isSuccess && (
            <Alert>
              <CircleCheck />
              <AlertTitle>已发送到 {mutation.variables.to}</AlertTitle>
              <AlertDescription>
                没有收到的话，先看看垃圾邮件，再核对服务器、端口和加密方式。
              </AlertDescription>
            </Alert>
          )}
        </form>
      </CardContent>
      <CardFooter>
        <Button type="submit" form="test-mail" disabled={mutation.isPending}>
          {mutation.isPending ? '发送中…' : '发送测试邮件'}
        </Button>
      </CardFooter>
    </Card>
  );
}

function MailTemplateCard({ template }: { template: MailTemplate }) {
  const canUpdate = useCan('system:settings:update');
  const queryClient = useQueryClient();
  const [subject, setSubject] = useState(template.subject);
  const [body, setBody] = useState(template.body);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [saved, setSaved] = useState(false);
  const [confirmingReset, setConfirmingReset] = useState(false);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const dirty = subject !== template.subject || body !== template.body;
  const examples = Object.fromEntries(
    template.placeholders.map((placeholder) => [placeholder.name, placeholder.example]),
  );
  const required = REQUIRED_PLACEHOLDERS[template.key];

  function store(next: MailTemplate) {
    queryClient.setQueryData(mailTemplatesQuery.queryKey, (list) =>
      list?.map((item) => (item.key === next.key ? next : item)),
    );
    setSubject(next.subject);
    setBody(next.body);
  }

  const mutation = useMutation({
    mutationFn: (input: UpdateMailTemplateInput) => updateMailTemplate(template.key, input),
    onSuccess: (next) => {
      store(next);
      setSaved(true);
    },
  });

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const input = parseForm(updateMailTemplateSchema, { subject, body }, setErrors);
    if (input) {
      mutation.mutate(input);
    }
  }

  function insert(name: string) {
    const textarea = bodyRef.current;
    const text = `{{${name}}}`;
    const start = textarea?.selectionStart ?? body.length;
    const end = textarea?.selectionEnd ?? body.length;
    setBody(body.slice(0, start) + text + body.slice(end));
    requestAnimationFrame(() => {
      textarea?.focus();
      textarea?.setSelectionRange(start + text.length, start + text.length);
    });
  }

  const formId = `mail-template-${template.key}`;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          邮件模板：{template.name}
          {template.customized && <Badge variant="secondary">已修改</Badge>}
        </CardTitle>
        <CardDescription>
          正文用纯文本写，发出时会排成统一的简单网页，链接可以点击。
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form id={formId} onSubmit={onSubmit} noValidate className="space-y-4">
          {mutation.error && (
            <Alert variant="destructive">
              <AlertDescription>{mutation.error.message}</AlertDescription>
            </Alert>
          )}
          <TextField
            name={`${formId}-subject`}
            label="主题"
            value={subject}
            onChange={(event) => setSubject(event.target.value)}
            error={errors['subject']}
            disabled={!canUpdate}
          />
          <TextareaField
            ref={bodyRef}
            name={`${formId}-body`}
            label="正文"
            rows={10}
            value={body}
            onChange={(event) => setBody(event.target.value)}
            error={errors['body']}
            disabled={!canUpdate}
          />
          {required && !body.includes(`{{${required}}}`) && (
            <p className="text-sm text-destructive">
              正文里没有 {`{{${required}}}`}，收件人会拿不到这个链接。
            </p>
          )}
          <div className="space-y-2">
            <p className="text-sm font-medium">
              占位符
              {canUpdate && (
                <span className="font-normal text-muted-foreground">
                  （点一下插入到正文光标处）
                </span>
              )}
            </p>
            <ul className="grid gap-1 text-sm text-muted-foreground sm:grid-cols-2">
              {template.placeholders.map((placeholder) => (
                <li key={placeholder.name}>
                  <button
                    type="button"
                    className="font-mono text-foreground underline-offset-4 enabled:hover:underline"
                    disabled={!canUpdate}
                    onClick={() => insert(placeholder.name)}
                  >
                    {`{{${placeholder.name}}}`}
                  </button>{' '}
                  {placeholder.description}
                </li>
              ))}
            </ul>
          </div>
          <div className="space-y-2">
            <p className="text-sm font-medium">预览（用示例数据）</p>
            <div className="rounded-lg border bg-muted/40 p-4 text-sm">
              <p className="font-medium break-words">{renderMailTemplate(subject, examples)}</p>
              <Separator className="my-3" />
              <p className="break-words whitespace-pre-wrap">
                {renderMailTemplate(body, examples)}
              </p>
            </div>
          </div>
        </form>
      </CardContent>
      {canUpdate && (
        <CardFooter className="gap-3">
          <Button type="submit" form={formId} disabled={!dirty || mutation.isPending}>
            {mutation.isPending ? '保存中…' : '保存模板'}
          </Button>
          {template.customized && (
            <Button variant="outline" onClick={() => setConfirmingReset(true)}>
              恢复默认
            </Button>
          )}
          {saved && !dirty && <span className="text-sm text-muted-foreground">已保存</span>}
        </CardFooter>
      )}
      {confirmingReset && (
        <ConfirmDialog
          title="恢复默认模板？"
          description="改过的主题和正文会换回系统自带的内容。"
          confirmLabel="恢复默认"
          action={async () => {
            store(await resetMailTemplate(template.key));
            setSaved(false);
          }}
          onClosed={() => setConfirmingReset(false)}
        />
      )}
    </Card>
  );
}
