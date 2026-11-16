import { updateLogtoSettingsSchema, type LogtoSettingsView } from '@fld/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, CircleAlert, CircleCheck, Copy } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { ErrorAlert } from '@/components/error-alert';
import { TextField } from '@/components/text-field';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { useCan } from '@/lib/auth';
import { parseForm, type FieldErrors } from '@/lib/form';
import { blankHint, logtoMissing, logtoSettingsQuery, updateLogtoSettings } from '@/lib/platform';
import { useAppName } from '@/lib/site';

function LogtoStatus({ view }: { view: LogtoSettingsView }) {
  if (view.ready) {
    return (
      <Alert>
        <CircleCheck />
        <AlertTitle>登录页已提供「使用 Logto 登录」</AlertTitle>
        <AlertDescription>填得对不对，用一个 Logto 账号登录一次就知道。</AlertDescription>
      </Alert>
    );
  }
  return (
    <Alert>
      <CircleAlert />
      <AlertTitle>登录页还没有「使用 Logto 登录」</AlertTitle>
      <AlertDescription>
        {view.enabled
          ? `还缺：${logtoMissing(view).join('、')}。`
          : '已关闭。勾选下面的开关并保存之后才会提供。'}
      </AlertDescription>
    </Alert>
  );
}

/** Signing in with Logto: the switch, the application, and the callback address. */
export function LogtoSettingsCard({ view }: { view: LogtoSettingsView }) {
  const appName = useAppName();
  const canUpdate = useCan('system:settings:update');
  const queryClient = useQueryClient();
  const { page, env, callbackUrl } = view;
  const [enabled, setEnabled] = useState(view.enabled);
  const [secret, setSecret] = useState('');
  const [clearSecret, setClearSecret] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const mutation = useMutation({
    mutationFn: updateLogtoSettings,
    onSuccess: (next) => {
      queryClient.setQueryData(logtoSettingsQuery.queryKey, next);
      setSecret('');
      setClearSecret(false);
      setSaved(true);
    },
  });

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaved(false);
    const form = new FormData(event.currentTarget);
    const input = parseForm(
      updateLogtoSettingsSchema,
      {
        enabled,
        url: form.get('logtoUrl'),
        appId: form.get('logtoAppId'),
        // Left blank, the saved secret stays.
        appSecret: clearSecret ? null : secret || undefined,
      },
      setErrors,
    );
    if (input) {
      mutation.mutate(input);
    }
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      // Without clipboard access (plain HTTP), the address stays there to copy by hand.
      setCopied(false);
    }
  }

  let secretHint: string;
  if (!view.canStoreSecrets) {
    secretHint =
      '没有配置 SETTINGS_ENCRYPTION_KEY，不能在页面上保存应用密钥；可以改用环境变量 LOGTO_APP_SECRET。';
  } else if (page.appSecret) {
    secretHint = '已保存（加密存放，不会显示）。留空则不修改。';
  } else if (env.appSecret) {
    secretHint = '留空则用环境变量里的应用密钥。';
  } else {
    secretHint = 'Logto 应用详情里的 App secret。';
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Logto 登录</CardTitle>
        <CardDescription>
          让用户在登录页用 Logto 账号登录。第一次登录按 Logto 里已验证的邮箱对应到 {appName}{' '}
          账号，之后认 Logto 账号；没有对应账号的不能登录。
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form id="logto-settings" onSubmit={onSubmit} noValidate className="space-y-4">
          <ErrorAlert error={mutation.error} />
          <LogtoStatus view={view} />
          <Label className="font-normal">
            <Checkbox
              checked={enabled}
              onCheckedChange={(checked) => setEnabled(checked)}
              disabled={!canUpdate}
            />
            在登录页提供「使用 Logto 登录」
          </Label>
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField
              name="logtoUrl"
              label="Logto 地址"
              type="url"
              defaultValue={page.url ?? ''}
              placeholder="https://auth.example.com"
              hint={blankHint(env.url, 'Logto 的访问地址。')}
              error={errors['url']}
              disabled={!canUpdate}
            />
            <TextField
              name="logtoAppId"
              label="应用 ID"
              autoComplete="off"
              defaultValue={page.appId ?? ''}
              hint={blankHint(env.appId, 'Logto 里「传统网页应用」的 App ID。')}
              error={errors['appId']}
              disabled={!canUpdate}
            />
            <div className="space-y-2">
              <TextField
                name="logtoAppSecret"
                label="应用密钥"
                type="password"
                autoComplete="new-password"
                value={secret}
                onChange={(event) => setSecret(event.target.value)}
                placeholder={page.appSecret ? '••••••••' : undefined}
                hint={secretHint}
                error={errors['appSecret']}
                disabled={!canUpdate || !view.canStoreSecrets || clearSecret}
              />
              {canUpdate && page.appSecret && (
                <Label className="font-normal">
                  <Checkbox
                    checked={clearSecret}
                    onCheckedChange={(checked) => setClearSecret(checked)}
                  />
                  {env.appSecret
                    ? '清除已保存的应用密钥，改用环境变量里的'
                    : '清除已保存的应用密钥'}
                </Label>
              )}
            </div>
          </div>
          <Separator />
          <div className="space-y-2">
            <Label htmlFor={callbackUrl ? 'logtoCallbackUrl' : undefined}>回调地址</Label>
            {callbackUrl ? (
              <div className="flex items-center gap-2">
                <Input
                  id="logtoCallbackUrl"
                  readOnly
                  value={callbackUrl}
                  onFocus={(event) => event.currentTarget.select()}
                />
                <Button type="button" variant="outline" onClick={() => void copy(callbackUrl)}>
                  {copied ? <Check /> : <Copy />}
                  {copied ? '已复制' : '复制'}
                </Button>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                先在上面的「邮件服务」里填好站点地址，这里才会给出回调地址。
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              要填到 Logto 应用的 Redirect URIs 里。它以站点地址开头，站点地址改了，Logto
              里也要跟着改。
            </p>
          </div>
          <p className="text-xs text-muted-foreground">
            换成另一个 Logto 之后，原来的账号对应关系不再生效，用户下次登录时重新按邮箱对应。
          </p>
        </form>
      </CardContent>
      {canUpdate && (
        <CardFooter className="gap-3">
          <Button type="submit" form="logto-settings" disabled={mutation.isPending}>
            {mutation.isPending ? '保存中…' : '保存'}
          </Button>
          {saved && <span className="text-sm text-muted-foreground">已保存</span>}
        </CardFooter>
      )}
    </Card>
  );
}
