import {
  renderMailTemplate,
  updateMailTemplateSchema,
  type MailTemplate,
  type MailTemplateKey,
  type UpdateMailTemplateInput,
} from '@fld/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRef, useState, type FormEvent } from 'react';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { ErrorAlert } from '@/components/error-alert';
import { TextField } from '@/components/text-field';
import { TextareaField } from '@/components/textarea-field';
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
import { Separator } from '@/components/ui/separator';
import { useCan } from '@/lib/auth';
import { parseForm, type FieldErrors } from '@/lib/form';
import { mailTemplatesQuery, resetMailTemplate, updateMailTemplate } from '@/lib/platform';

/** The placeholder a template is useless without. */
const REQUIRED_PLACEHOLDERS: Partial<Record<MailTemplateKey, string>> = {
  'password-reset': '重设链接',
  'email-change': '确认链接',
};

/** One mail template: its subject and body, the placeholders, and a preview. */
export function MailTemplateCard({ template }: { template: MailTemplate }) {
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
          <ErrorAlert error={mutation.error} />
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
