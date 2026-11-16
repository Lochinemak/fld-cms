import { CircleAlert, CircleCheck } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

/** Whether mail can be sent yet, and what depends on it. */
export function MailStatus({ ready }: { ready: boolean }) {
  return ready ? (
    <Alert>
      <CircleCheck />
      <AlertTitle>邮件服务已就绪</AlertTitle>
      <AlertDescription>
        用户可以用「忘记密码」通过邮件重设密码，也可以在「个人资料」里修改自己的邮箱。
      </AlertDescription>
    </Alert>
  ) : (
    <Alert>
      <CircleAlert />
      <AlertTitle>邮件服务还没配好</AlertTitle>
      <AlertDescription>
        填好 SMTP
        服务器、发件人地址和站点地址之后，用户才能用「忘记密码」、才能修改自己的邮箱；在这之前，忘记密码只能请管理员重置，邮箱改不了。
      </AlertDescription>
    </Alert>
  );
}
