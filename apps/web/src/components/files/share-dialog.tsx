import type { FileShare } from '@fld/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Copy } from 'lucide-react';
import { useState } from 'react';
import { ErrorAlert } from '@/components/error-alert';
import { SelectField, type SelectOption } from '@/components/select-field';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useMountedDialog } from '@/hooks/use-mounted-dialog';
import { formatDateTime } from '@/lib/crm';
import { createShare, deleteShare, shareLink, sharesQuery } from '@/lib/files';

type Expiry = '1' | '7' | '30' | 'never';

const EXPIRY_OPTIONS: SelectOption<Expiry>[] = [
  { value: '1', label: '1 天' },
  { value: '7', label: '7 天' },
  { value: '30', label: '30 天' },
  { value: 'never', label: '永久有效' },
];

/** What to send someone: the link, and its code if it has one. */
function shareText(share: FileShare): string {
  const link = shareLink(share.token);
  return share.code ? `${link} 提取码：${share.code}` : link;
}

interface ShareDialogProps {
  file: { id: string; name: string };
  onClosed: () => void;
}

/** The file's share links: make new ones, copy them, and revoke them one by one. */
export function ShareDialog({ file, onClosed }: ShareDialogProps) {
  const queryClient = useQueryClient();
  const dialog = useMountedDialog(onClosed);
  const { data: shares, error } = useQuery(sharesQuery(file.id));
  const [expiry, setExpiry] = useState<Expiry>('7');
  const [withCode, setWithCode] = useState(false);
  const [copiedId, setCopiedId] = useState<string>();
  const [revokingId, setRevokingId] = useState<string>();
  const refresh = () => queryClient.invalidateQueries({ queryKey: sharesQuery(file.id).queryKey });

  async function copy(share: FileShare) {
    try {
      await navigator.clipboard.writeText(shareText(share));
      setCopiedId(share.id);
    } catch {
      // Without clipboard access (plain HTTP), the link stays there to copy by hand.
      setCopiedId(undefined);
    }
  }

  const create = useMutation({
    mutationFn: () =>
      createShare(file.id, {
        expiresInDays: expiry === 'never' ? null : (Number(expiry) as 1 | 7 | 30),
        withCode,
      }),
    onSuccess: async (share) => {
      await refresh();
      await copy(share);
    },
  });
  const revoke = useMutation({
    mutationFn: deleteShare,
    onSuccess: async () => {
      setRevokingId(undefined);
      await refresh();
    },
  });
  const failure = create.error ?? revoke.error ?? error;

  return (
    <Dialog {...dialog.rootProps()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>分享「{file.name}」</DialogTitle>
          <DialogDescription>
            拿到链接的人不用登录就能下载，图片和 PDF
            还能在线预览。文件被删除、链接到期或被撤销后就打不开了。
          </DialogDescription>
        </DialogHeader>
        <ErrorAlert error={failure} />
        <div className="flex flex-wrap items-end gap-4 rounded-md border p-3">
          <div className="w-32">
            <SelectField
              id="share-expiry"
              label="有效期"
              options={EXPIRY_OPTIONS}
              value={expiry}
              onValueChange={(value) => setExpiry(value ?? '7')}
            />
          </div>
          <Label className="h-8 font-normal">
            <Checkbox checked={withCode} onCheckedChange={(checked) => setWithCode(checked)} />
            需要提取码
          </Label>
          <Button className="ml-auto" disabled={create.isPending} onClick={() => create.mutate()}>
            {create.isPending ? '生成中…' : '生成链接'}
          </Button>
        </div>
        <div className="max-h-80 space-y-2 overflow-y-auto">
          {!shares ? (
            <p className="text-sm text-muted-foreground">{!error && '加载中…'}</p>
          ) : shares.length === 0 ? (
            <p className="text-sm text-muted-foreground">还没有分享链接。</p>
          ) : (
            shares.map((share) => (
              <div key={share.id} className="space-y-2 rounded-md border p-3 text-sm">
                <div className="flex items-center gap-2">
                  <Input
                    readOnly
                    value={shareLink(share.token)}
                    aria-label="分享链接"
                    className="h-8 font-mono text-xs"
                    onFocus={(event) => event.currentTarget.select()}
                  />
                  <Button variant="outline" size="sm" onClick={() => void copy(share)}>
                    {copiedId === share.id ? <Check /> : <Copy />}
                    {copiedId === share.id ? '已复制' : '复制'}
                  </Button>
                </div>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  {share.code && (
                    <Badge variant="secondary" className="font-mono">
                      提取码 {share.code}
                    </Badge>
                  )}
                  <span>
                    {share.expiresAt ? `${formatDateTime(share.expiresAt)} 到期` : '永久有效'}
                  </span>
                  <span>
                    打开 {share.accessCount} 次
                    {share.lastAccessedAt && `，最近 ${formatDateTime(share.lastAccessedAt)}`}
                  </span>
                  <span>{share.creator.displayName} 创建</span>
                  <span className="ml-auto flex gap-1">
                    {revokingId === share.id && (
                      <Button variant="ghost" size="xs" onClick={() => setRevokingId(undefined)}>
                        取消
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="xs"
                      className="text-destructive"
                      disabled={revoke.isPending}
                      onClick={() =>
                        revokingId === share.id ? revoke.mutate(share.id) : setRevokingId(share.id)
                      }
                    >
                      {revokingId === share.id ? '确认撤销' : '撤销'}
                    </Button>
                  </span>
                </div>
              </div>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
