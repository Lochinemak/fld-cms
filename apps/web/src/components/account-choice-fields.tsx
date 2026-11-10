import type { AccountChoice } from '@fld/shared';
import { TextField } from '@/components/text-field';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { optionalText, type FieldErrors } from '@/lib/form';

export type AccountMode = AccountChoice['mode'];

interface AccountChoiceFieldsProps {
  /** The input property holding the choice. Fields are named after it: `admin.username`. */
  name: string;
  mode: AccountMode;
  onModeChange: (mode: AccountMode) => void;
  errors: FieldErrors;
}

/** Picks an existing account by username or email, or enters a new one. */
export function AccountChoiceFields({
  name,
  mode,
  onModeChange,
  errors,
}: AccountChoiceFieldsProps) {
  const field = (key: string) => ({ name: `${name}.${key}`, error: errors[`${name}.${key}`] });

  return (
    <div className="space-y-4">
      <RadioGroup
        value={mode}
        onValueChange={(value) => onModeChange(value as AccountMode)}
        className="flex gap-6"
      >
        <Label className="font-normal">
          <RadioGroupItem value="existing" />
          已有账号
        </Label>
        <Label className="font-normal">
          <RadioGroupItem value="new" />
          新建账号
        </Label>
      </RadioGroup>
      {mode === 'existing' ? (
        <TextField
          {...field('account')}
          label="用户名或邮箱"
          autoComplete="off"
          hint="账号全局唯一，可以同时属于多个租户。"
        />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField {...field('username')} label="用户名" autoComplete="off" />
            <TextField {...field('displayName')} label="姓名" autoComplete="off" />
          </div>
          <TextField {...field('email')} label="邮箱（选填）" type="email" autoComplete="off" />
          <TextField
            {...field('password')}
            label="初始密码（选填）"
            type="password"
            autoComplete="new-password"
            hint="留空则自动生成，并只显示一次。对方登录后必须先修改密码。"
          />
        </>
      )}
    </div>
  );
}

/** The choice as entered, for the schema to check. */
export function readAccountChoice(form: FormData, name: string, mode: AccountMode): unknown {
  const value = (key: string) => form.get(`${name}.${key}`);
  return mode === 'existing'
    ? { mode, account: value('account') }
    : {
        mode,
        username: value('username'),
        displayName: value('displayName'),
        email: optionalText(value('email')),
        password: optionalText(value('password')),
      };
}
