import { testMailSchema } from '@fld/shared';
import { useMutation } from '@tanstack/react-query';
import { CircleCheck } from 'lucide-react';
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
import { useCan, useMe } from '@/lib/auth';
import { parseForm, type FieldErrors } from '@/lib/form';
import { sendTestMail } from '@/lib/platform';

/** Sends a mail with the saved settings, to check that it arrives. */
export function TestMailCard() {
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
          <ErrorAlert error={mutation.error} />
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
