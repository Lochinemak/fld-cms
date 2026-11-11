import { EMAIL_CHANGE_MINUTES, updateProfileSchema } from '@fld/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { MailCheck } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { PasswordField } from '@/components/change-password-form';
import { ErrorAlert } from '@/components/error-alert';
import { TextField } from '@/components/text-field';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
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
import { useMountedDialog } from '@/hooks/use-mounted-dialog';
import { applyMe, updateProfile, useMe } from '@/lib/auth';
import { parseForm, type FieldErrors } from '@/lib/form';

/**
 * The signed-in user's own name and email, over the page they are on. The name is saved at once;
 * a new email takes the password, and a click on the link mailed to it.
 */
export function ProfileDialog({ onClosed }: { onClosed: () => void }) {
  const { user } = useMe();
  const queryClient = useQueryClient();
  const dialog = useMountedDialog(onClosed);
  // What was typed, if anything: until then the fields show what the account has, which another
  // tab may have changed since this one last asked.
  const [typedName, setTypedName] = useState<string>();
  const [typedEmail, setTypedEmail] = useState<string>();
  const [errors, setErrors] = useState<FieldErrors>({});
  const [nameSaved, setNameSaved] = useState(false);
  const mutation = useMutation({
    mutationFn: updateProfile,
    onSuccess: ({ me, confirmationSentTo }) => {
      applyMe(queryClient, me);
      // Lists and logs name the user too.
      void queryClient.invalidateQueries();
      if (!confirmationSentTo) {
        dialog.close();
      }
    },
  });

  const name = typedName ?? user.displayName;
  const email = typedEmail ?? user.email ?? '';
  const newEmail = email.trim().toLowerCase();
  const emailChanges = newEmail !== (user.email ?? '');
  const sentTo = mutation.data?.confirmationSentTo;

  let emailHint = '用于接收「忘记密码」的重设链接；第一次用 Logto 登录时，也靠它找到这个账号。';
  if (emailChanges) {
    emailHint = newEmail
      ? '保存后会往这个地址发一封确认邮件，在邮件里确认后才生效。'
      : '清空后，就不能用「忘记密码」通过邮件重设密码了。';
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const input = parseForm(
      updateProfileSchema,
      {
        displayName: name,
        email,
        ...(emailChanges && { currentPassword: form.get('currentPassword') }),
      },
      setErrors,
    );
    if (!input) {
      return;
    }
    if (input.email !== user.email && !input.currentPassword) {
      setErrors({ currentPassword: '修改邮箱需要输入当前密码' });
      return;
    }
    setNameSaved(input.displayName !== user.displayName);
    mutation.mutate(input);
  }

  return (
    <Dialog {...dialog.rootProps(mutation.isPending)}>
      <DialogContent className="sm:max-w-sm">
        {sentTo ? (
          <div className="grid gap-4">
            <DialogHeader>
              <DialogTitle>个人资料</DialogTitle>
              <DialogDescription>还差一步：到新邮箱里确认。</DialogDescription>
            </DialogHeader>
            <Alert>
              <MailCheck />
              <AlertTitle className="break-all">确认邮件已发到 {sentTo}</AlertTitle>
              <AlertDescription>
                请在 {EMAIL_CHANGE_MINUTES}{' '}
                分钟内打开邮件里的链接，点击「确认修改邮箱」后才生效；在这之前，你的邮箱不变。
                {nameSaved && '姓名已保存。'}
              </AlertDescription>
            </Alert>
            <DialogFooter>
              <Button onClick={dialog.close}>知道了</Button>
            </DialogFooter>
          </div>
        ) : (
          <form onSubmit={submit} noValidate className="grid gap-4">
            <DialogHeader>
              <DialogTitle>个人资料</DialogTitle>
              <DialogDescription>
                修改邮箱需要输入当前密码，并在新邮箱里确认后才生效。
              </DialogDescription>
            </DialogHeader>
            <ErrorAlert error={mutation.error} />
            <TextField
              name="username"
              label="用户名"
              value={user.username}
              autoComplete="username"
              readOnly
              disabled
              hint="用户名不能修改。"
            />
            <TextField
              name="displayName"
              label="姓名"
              value={name}
              onChange={(event) => setTypedName(event.target.value)}
              maxLength={64}
              autoComplete="name"
              error={errors['displayName']}
            />
            <TextField
              name="email"
              type="email"
              label="邮箱（选填）"
              value={email}
              onChange={(event) => setTypedEmail(event.target.value)}
              autoComplete="email"
              error={errors['email']}
              hint={emailHint}
            />
            {emailChanges && (
              <PasswordField
                name="currentPassword"
                label="当前密码"
                autoComplete="current-password"
                error={errors['currentPassword']}
              />
            )}
            <DialogFooter>
              <DialogClose render={<Button variant="outline" />} disabled={mutation.isPending}>
                取消
              </DialogClose>
              <Button type="submit" disabled={mutation.isPending}>
                {mutation.isPending ? '保存中…' : '保存'}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
