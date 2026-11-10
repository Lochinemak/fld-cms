import type { PublicShare } from '@fld/shared';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { Download, Eye } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { FileIcon } from '@/components/files/file-icon';
import { FieldError } from '@/components/field-error';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ApiError } from '@/lib/api';
import { formatDateTime } from '@/lib/crm';
import { canPreview, formatSize, publicContentUrl, publicShareQuery } from '@/lib/files';

/** A share link's page, for anyone who has the link: no sign-in. */
export const Route = createFileRoute('/s/$token')({
  component: SharePage,
});

function SharePage() {
  const { token } = Route.useParams();
  const [code, setCode] = useState<string>();
  // Without a code the link still says whether it needs one and when it runs out; that stays on
  // the page, and the code form keeps what was typed, while each code is tried.
  const link = useQuery(publicShareQuery(token, undefined));
  const opened = useQuery({ ...publicShareQuery(token, code), enabled: code !== undefined });
  const error = link.error ?? opened.error;
  const wrongCode = error instanceof ApiError && error.status === 403;
  const file = link.data?.file ?? opened.data?.file;

  return (
    <main className="flex min-h-svh items-center justify-center bg-muted/40 p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>文件分享</CardTitle>
          <CardDescription>
            {link.data?.expiresAt
              ? `链接在 ${formatDateTime(link.data.expiresAt)} 到期`
              : link.data
                ? '链接长期有效'
                : '打开别人分享给你的文件'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {error && !wrongCode ? (
            <Alert variant="destructive">
              <AlertDescription>{error.message}</AlertDescription>
            </Alert>
          ) : file ? (
            <SharedFile token={token} code={code} file={file} />
          ) : link.data?.codeRequired ? (
            <CodeForm
              error={wrongCode ? error.message : undefined}
              pending={opened.isFetching}
              onSubmit={setCode}
            />
          ) : (
            <p className="text-sm text-muted-foreground">加载中…</p>
          )}
        </CardContent>
      </Card>
    </main>
  );
}

function CodeForm({
  error,
  pending,
  onSubmit,
}: {
  error: string | undefined;
  pending: boolean;
  onSubmit: (code: string) => void;
}) {
  const [empty, setEmpty] = useState(false);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const code = String(new FormData(event.currentTarget).get('code') ?? '').trim();
    setEmpty(code === '');
    if (code) {
      onSubmit(code);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="code">提取码</Label>
        <Input
          id="code"
          name="code"
          maxLength={8}
          autoComplete="off"
          autoFocus
          aria-invalid={empty || !!error}
          className="font-mono uppercase"
        />
        <FieldError message={empty ? '请输入提取码' : error} />
        <p className="text-xs text-muted-foreground">分享的人把链接发给你时会一起告诉你提取码。</p>
      </div>
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? '打开中…' : '打开文件'}
      </Button>
    </form>
  );
}

function SharedFile({
  token,
  code,
  file,
}: {
  token: string;
  code: string | undefined;
  file: NonNullable<PublicShare['file']>;
}) {
  const previewable = canPreview(file.mimeType);
  const contentUrl = publicContentUrl(token, code);

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3">
        <FileIcon
          mimeType={file.mimeType}
          className="mt-0.5 size-8 shrink-0 text-muted-foreground"
        />
        <div className="min-w-0">
          <p className="font-medium break-all">{file.name}</p>
          <p className="text-sm text-muted-foreground">{formatSize(file.size)}</p>
        </div>
      </div>
      {file.mimeType.startsWith('image/') && previewable && (
        <img
          src={contentUrl}
          alt={file.name}
          className="max-h-80 w-full rounded-md border object-contain"
        />
      )}
      <div className="flex gap-2">
        {previewable && (
          <a
            href={contentUrl}
            target="_blank"
            rel="noreferrer"
            className={buttonVariants({ variant: 'outline', className: 'flex-1' })}
          >
            <Eye />
            在线预览
          </a>
        )}
        <a
          href={publicContentUrl(token, code, true)}
          className={buttonVariants({ className: 'flex-1' })}
        >
          <Download />
          下载
        </a>
      </div>
    </div>
  );
}
