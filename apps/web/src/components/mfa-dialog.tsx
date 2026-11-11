import type { MfaSetup } from '@fld/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Copy, ShieldCheck } from 'lucide-react';
import QRCode from 'qrcode';
import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
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
  const { t } = useTranslation('account');
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
    body = <p className="text-sm text-muted-foreground">{t('loading', { ns: 'common' })}</p>;
  } else if (status.error) {
    body = <ErrorAlert error={status.error} />;
  } else if (step.kind === 'codes') {
    body = <RecoveryCodesView codes={step.codes} />;
  } else if (step.kind === 'scan') {
    body = (
      <form id="mfa-step" onSubmit={submitCode} noValidate className="space-y-4">
        <ErrorAlert error={confirm.error} />
        <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
          <li>{t('mfaStepOpenApp')}</li>
          <li>{t('mfaStepScan')}</li>
          <li>{t('mfaStepEnterCode')}</li>
        </ol>
        <QrCode text={step.setup.uri} />
        <p className="text-center font-mono text-xs break-all text-muted-foreground select-all">
          {step.setup.secret}
        </p>
        <div className="space-y-2">
          <Label htmlFor="mfa-code">{t('codeLabel', { ns: 'auth' })}</Label>
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
          <Label htmlFor="mfa-password">{t('currentPassword', { ns: 'auth' })}</Label>
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
        <AlertDescription>{t('mfaUnavailable')}</AlertDescription>
      </Alert>
    );
  } else if (status.data.enabled) {
    body = (
      <div className="space-y-3 text-sm">
        <ErrorAlert error={renew.error} />
        <p className="flex items-center gap-2 font-medium">
          <ShieldCheck className="size-4 text-emerald-600" />
          {t('mfaOn')}
        </p>
        <p className="text-muted-foreground">
          {t('recoveryCodesLeft', { count: status.data.recoveryCodesLeft })}
        </p>
      </div>
    );
  } else {
    body = <p className="text-sm text-muted-foreground">{t('mfaOffIntro')}</p>;
  }

  let footer;
  if (step.kind === 'codes') {
    footer = (
      <DialogClose render={<Button />} onClick={() => setStep({ kind: 'overview' })}>
        {t('codesSaved')}
      </DialogClose>
    );
  } else if (step.kind === 'scan' || step.kind === 'password') {
    const label =
      step.kind === 'scan' ? t('enable') : step.purpose === 'enable' ? t('next') : t('disableMfa');
    footer = (
      <>
        <Button variant="outline" disabled={busy} onClick={() => setStep({ kind: 'overview' })}>
          {t('back')}
        </Button>
        <Button
          type="submit"
          form="mfa-step"
          variant={
            step.kind === 'password' && step.purpose === 'disable' ? 'destructive' : 'default'
          }
          disabled={busy}
        >
          {busy ? t('pleaseWait') : label}
        </Button>
      </>
    );
  } else if (status.data?.available && status.data.enabled) {
    footer = (
      <>
        <Button variant="outline" disabled={busy} onClick={() => renew.mutate()}>
          {t('renewRecoveryCodes')}
        </Button>
        <Button
          variant="destructive"
          disabled={busy}
          onClick={() => {
            disable.reset();
            setStep({ kind: 'password', purpose: 'disable' });
          }}
        >
          {t('disableMfa')}
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
        {t('enableMfa')}
      </Button>
    );
  }

  return (
    // The recovery codes must not vanish with a click outside the dialog.
    <Dialog {...dialog.rootProps(busy)} disablePointerDismissal={step.kind === 'codes'}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('mfaTitle')}</DialogTitle>
          <DialogDescription>{t('mfaDescription')}</DialogDescription>
        </DialogHeader>
        {body}
        {footer && <DialogFooter>{footer}</DialogFooter>}
      </DialogContent>
    </Dialog>
  );
}

function QrCode({ text }: { text: string }) {
  const { t } = useTranslation('account');
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
        <img src={src} alt={t('qrCodeAlt')} className="size-48 rounded-md border bg-white" />
      ) : (
        <div className="size-48 rounded-md border bg-muted" />
      )}
    </div>
  );
}

function RecoveryCodesView({ codes }: { codes: string[] }) {
  const { t } = useTranslation('account');
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
        <AlertDescription>{t('recoveryCodesNotice')}</AlertDescription>
      </Alert>
      <ul className="grid grid-cols-2 gap-2 rounded-lg border bg-muted p-3 font-mono text-sm select-all">
        {codes.map((code) => (
          <li key={code}>{code}</li>
        ))}
      </ul>
      <Button variant="outline" size="sm" onClick={() => void copy()}>
        {copied ? <Check /> : <Copy />}
        {copied ? t('copied') : t('copyAll')}
      </Button>
    </div>
  );
}
