import type { MfaSetup } from '@fld/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Copy, ShieldCheck } from 'lucide-react';
import QRCode from 'qrcode';
import { useEffect, useState, type FormEvent } from 'react';
import { ErrorAlert } from '@/components/error-alert';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useMountedDialog } from '@/hooks/use-mounted-dialog';
import {
  confirmMfaSetup,
  disableMfa,
  mfaStatusQuery,
  renewRecoveryCodes,
  startMfaSetup,
} from '@/lib/auth';

type Step =
  | { kind: 'overview' }
  | { kind: 'password'; purpose: 'enable' | 'disable' }
  | { kind: 'scan'; setup: MfaSetup }
  | { kind: 'codes'; codes: string[] };

/** The signed-in user's two-step sign-in: turning it on with an authenticator app, and off. */
export function MfaDialog({ onClosed }: { onClosed: () => void }) {
  const dialog = useMountedDialog(onClosed);
  const queryClient = useQueryClient();
  const status = useQuery(mfaStatusQuery);
  const [step, setStep] = useState<Step>({ kind: 'overview' });
  const refresh = () => queryClient.invalidateQueries({ queryKey: mfaStatusQuery.queryKey });

  const start = useMutation({
    mutationFn: startMfaSetup,
    onSuccess: (setup) => setStep({ kind: 'scan', setup }),
  });
  const confirm = useMutation({
    mutationFn: confirmMfaSetup,
    onSuccess: ({ recoveryCodes }) => {
      void refresh();
      setStep({ kind: 'codes', codes: recoveryCodes });
    },
  });
  const renew = useMutation({
    mutationFn: renewRecoveryCodes,
    onSuccess: ({ recoveryCodes }) => {
      void refresh();
      setStep({ kind: 'codes', codes: recoveryCodes });
    },
  });
  const disable = useMutation({
    mutationFn: disableMfa,
    onSuccess: () => {
      void refresh();
      setStep({ kind: 'overview' });
    },
  });
  const busy = start.isPending || confirm.isPending || renew.isPending || disable.isPending;

  function submitPassword(event: FormEvent<HTMLFormElement>, purpose: 'enable' | 'disable') {
    event.preventDefault();
    const currentPassword = String(new FormData(event.currentTarget).get('currentPassword') ?? '');
    (purpose === 'enable' ? start : disable).mutate({ currentPassword });
  }

  function submitCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    confirm.mutate({ code: String(new FormData(event.currentTarget).get('code') ?? '').trim() });
  }

  let body;
  if (status.isPending) {
    body = <p className="text-sm text-muted-foreground">加载中…</p>;
  } else if (status.error) {
    body = <ErrorAlert error={status.error} />;
  } else if (step.kind === 'codes') {
    body = <RecoveryCodesView codes={step.codes} />;
  } else if (step.kind === 'scan') {
    body = (
      <form id="mfa-step" onSubmit={submitCode} noValidate className="space-y-4">
        <ErrorAlert error={confirm.error} />
        <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
          <li>在手机上打开验证器应用（如 Google Authenticator、Microsoft Authenticator）。</li>
          <li>扫描下面的二维码，或者手动输入密钥。</li>
          <li>输入应用显示的 6 位数字。</li>
        </ol>
        <QrCode text={step.setup.uri} />
        <p className="text-center font-mono text-xs break-all text-muted-foreground select-all">
          {step.setup.secret}
        </p>
        <div className="space-y-2">
          <Label htmlFor="mfa-code">验证码</Label>
          <Input
            id="mfa-code"
            name="code"
            autoFocus
            autoComplete="one-time-code"
            inputMode="numeric"
            maxLength={6}
          />
        </div>
      </form>
    );
  } else if (step.kind === 'password') {
    const error = step.purpose === 'enable' ? start.error : disable.error;
    body = (
      <form
        id="mfa-step"
        onSubmit={(event) => submitPassword(event, step.purpose)}
        noValidate
        className="space-y-4"
      >
        <ErrorAlert error={error} />
        <div className="space-y-2">
          <Label htmlFor="mfa-password">当前密码</Label>
          <Input
            id="mfa-password"
            name="currentPassword"
            type="password"
            autoFocus
            autoComplete="current-password"
          />
        </div>
      </form>
    );
  } else if (!status.data.available) {
    body = (
      <Alert>
        <AlertDescription>
          服务器还没有配置 SETTINGS_ENCRYPTION_KEY，暂时不能开启两步验证，请联系管理员。
        </AlertDescription>
      </Alert>
    );
  } else if (status.data.enabled) {
    body = (
      <div className="space-y-3 text-sm">
        <ErrorAlert error={renew.error} />
        <p className="flex items-center gap-2 font-medium">
          <ShieldCheck className="size-4 text-emerald-600" />
          已开启：登录时除了密码，还要输入验证器里的验证码。
        </p>
        <p className="text-muted-foreground">
          剩余恢复码 {status.data.recoveryCodesLeft} 个。手机丢了时，用恢复码登录。
        </p>
      </div>
    );
  } else {
    body = (
      <p className="text-sm text-muted-foreground">
        开启后，用密码或 Logto 登录时，还要输入手机验证器应用里的 6
        位验证码。别人知道了你的密码也登录不了。
      </p>
    );
  }

  let footer;
  if (step.kind === 'codes') {
    footer = (
      <DialogClose render={<Button />} onClick={() => setStep({ kind: 'overview' })}>
        我已保存
      </DialogClose>
    );
  } else if (step.kind === 'scan' || step.kind === 'password') {
    const label =
      step.kind === 'scan' ? '开启' : step.purpose === 'enable' ? '下一步' : '关闭两步验证';
    footer = (
      <>
        <Button variant="outline" disabled={busy} onClick={() => setStep({ kind: 'overview' })}>
          返回
        </Button>
        <Button
          type="submit"
          form="mfa-step"
          variant={
            step.kind === 'password' && step.purpose === 'disable' ? 'destructive' : 'default'
          }
          disabled={busy}
        >
          {busy ? '请稍候…' : label}
        </Button>
      </>
    );
  } else if (status.data?.available && status.data.enabled) {
    footer = (
      <>
        <Button variant="outline" disabled={busy} onClick={() => renew.mutate()}>
          重新生成恢复码
        </Button>
        <Button
          variant="destructive"
          disabled={busy}
          onClick={() => {
            disable.reset();
            setStep({ kind: 'password', purpose: 'disable' });
          }}
        >
          关闭两步验证
        </Button>
      </>
    );
  } else if (status.data?.available) {
    footer = (
      <Button
        onClick={() => {
          start.reset();
          setStep({ kind: 'password', purpose: 'enable' });
        }}
      >
        开启两步验证
      </Button>
    );
  }

  return (
    // The recovery codes must not vanish with a click outside the dialog.
    <Dialog {...dialog.rootProps(busy)} disablePointerDismissal={step.kind === 'codes'}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>两步验证</DialogTitle>
          <DialogDescription>用手机上的验证器应用，给登录多加一道保护。</DialogDescription>
        </DialogHeader>
        {body}
        {footer && <DialogFooter>{footer}</DialogFooter>}
      </DialogContent>
    </Dialog>
  );
}

function QrCode({ text }: { text: string }) {
  const [src, setSrc] = useState<string>();
  useEffect(() => {
    let current = true;
    void QRCode.toDataURL(text, { margin: 1, width: 192 }).then((url) => {
      if (current) setSrc(url);
    });
    return () => {
      current = false;
    };
  }, [text]);
  return (
    <div className="flex justify-center">
      {src ? (
        <img src={src} alt="两步验证的二维码" className="size-48 rounded-md border bg-white" />
      ) : (
        <div className="size-48 rounded-md border bg-muted" />
      )}
    </div>
  );
}

function RecoveryCodesView({ codes }: { codes: string[] }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(codes.join('\n'));
      setCopied(true);
    } catch {
      // The codes stay on screen to copy by hand.
    }
  }
  return (
    <div className="space-y-3">
      <Alert>
        <AlertDescription>
          这些恢复码只显示这一次。把它们保存在手机以外的地方：手机丢了时，每个码可以代替验证码登录一次。
        </AlertDescription>
      </Alert>
      <ul className="grid grid-cols-2 gap-2 rounded-lg border bg-muted p-3 font-mono text-sm select-all">
        {codes.map((code) => (
          <li key={code}>{code}</li>
        ))}
      </ul>
      <Button variant="outline" size="sm" onClick={() => void copy()}>
        {copied ? <Check /> : <Copy />}
        {copied ? '已复制' : '复制全部'}
      </Button>
    </div>
  );
}
