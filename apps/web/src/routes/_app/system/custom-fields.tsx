import {
  CUSTOM_FIELD_ENTITIES,
  CUSTOM_FIELD_TYPES,
  createCustomFieldSchema,
  directoryOf,
  isSelectType,
  updateCustomFieldSchema,
  type CustomField,
  type CustomFieldEntity,
  type CustomFieldType,
} from '@fld/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { Plus } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Can } from '@/components/can';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { ErrorAlert } from '@/components/error-alert';
import { FieldError } from '@/components/field-error';
import { FormDialog } from '@/components/form-dialog';
import { PageHeader } from '@/components/page-header';
import { RequirePermission } from '@/components/require-permission';
import { SelectField } from '@/components/select-field';
import { TableMessage } from '@/components/table-message';
import { TextField } from '@/components/text-field';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useMountedDialog } from '@/hooks/use-mounted-dialog';
import { useCan, useMe } from '@/lib/auth';
import {
  createCustomField,
  customFieldsQuery,
  deleteCustomField,
  dictionariesQuery,
  refreshCustomFields,
  updateCustomField,
} from '@/lib/custom-fields';
import { parseForm, type FieldErrors } from '@/lib/form';

export const Route = createFileRoute('/_app/system/custom-fields')({
  component: () => (
    <RequirePermission code="system:custom-field">
      <CustomFieldsPage />
    </RequirePermission>
  ),
});

const ENTITY_CODES = Object.keys(CUSTOM_FIELD_ENTITIES) as CustomFieldEntity[];

const TYPE_OPTIONS = (Object.keys(CUSTOM_FIELD_TYPES) as CustomFieldType[]).map((type) => ({
  value: type,
  label: CUSTOM_FIELD_TYPES[type],
}));

/** What each type asks of whoever fills the field in, shown under the type. */
const TYPE_HINTS: Record<CustomFieldType, string> = {
  TEXT: '填一行文字，最多 200 字，如合同编号、官网地址。',
  TEXTAREA: '填多行文字，最多 2000 字，如需求说明。',
  NUMBER: '填一个数字，可带小数，如年采购额、员工人数。',
  DATE: '从日历里选一天，如签约日。',
  BOOLEAN: '一个开关，打开或关闭，如是否 VIP、是否已签保密协议。',
  SELECT: '从数据字典的选项里选一个，如所属区域。',
  MULTI_SELECT: '从数据字典的选项里选几个，如关注的产品线。',
};

/** The field to edit; null for a new one. */
interface DialogState {
  field: CustomField | null;
}

function CustomFieldsPage() {
  const me = useMe();
  const queryClient = useQueryClient();
  const canUpdate = useCan('system:custom-field:update');
  const disabledModules = me.tenant?.disabledModules ?? [];
  // A model of a module switched off for the tenant isn't offered.
  const entities = ENTITY_CODES.filter(
    (code) => !disabledModules.includes(directoryOf(CUSTOM_FIELD_ENTITIES[code].permission)),
  );
  const [picked, setPicked] = useState<CustomFieldEntity | null>(null);
  const entity = picked && entities.includes(picked) ? picked : (entities[0] ?? null);
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [removing, setRemoving] = useState<CustomField | null>(null);
  const columns = canUpdate ? 8 : 7;

  return (
    <div className="space-y-6">
      <PageHeader
        title="自定义字段"
        description="给客户、联系人等添加自己的字段，它们会出现在表单、详情和列表里。"
        actions={
          entity && (
            <Can code="system:custom-field:update">
              <Button onClick={() => setDialog({ field: null })}>
                <Plus />
                新增字段
              </Button>
            </Can>
          )
        }
      />
      {entity === null ? (
        <p className="text-sm text-muted-foreground">本租户没有可以添加字段的模块。</p>
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            {entities.map((code) => (
              <Button
                key={code}
                variant={code === entity ? 'secondary' : 'ghost'}
                size="sm"
                aria-pressed={code === entity}
                onClick={() => setPicked(code)}
              >
                {CUSTOM_FIELD_ENTITIES[code].name}
              </Button>
            ))}
          </div>
          <FieldsTable
            entity={entity}
            canUpdate={canUpdate}
            columns={columns}
            onEdit={(field) => setDialog({ field })}
            onRemove={setRemoving}
          />
          {dialog && (
            <FieldDialog entity={entity} field={dialog.field} onClosed={() => setDialog(null)} />
          )}
        </>
      )}
      {removing && (
        <ConfirmDialog
          title={`删除字段「${removing.label}」？`}
          description="已经填的值会保留在记录里，再新增同样标识的字段就能重新显示。"
          confirmLabel="删除"
          destructive
          action={async () => {
            await deleteCustomField(removing.id);
            await refreshCustomFields(queryClient);
          }}
          onClosed={() => setRemoving(null)}
        />
      )}
    </div>
  );
}

interface FieldsTableProps {
  entity: CustomFieldEntity;
  canUpdate: boolean;
  columns: number;
  onEdit: (field: CustomField) => void;
  onRemove: (field: CustomField) => void;
}

function FieldsTable({ entity, canUpdate, columns, onEdit, onRemove }: FieldsTableProps) {
  const { data: fields, error, isPending } = useQuery(customFieldsQuery(entity));

  return (
    <>
      <ErrorAlert error={error} />
      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>字段名称</TableHead>
              <TableHead>标识</TableHead>
              <TableHead>类型</TableHead>
              <TableHead>必填</TableHead>
              <TableHead>列表显示</TableHead>
              <TableHead>数据字典</TableHead>
              <TableHead className="text-right">排序</TableHead>
              {canUpdate && <TableHead className="w-0" />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {isPending && <TableMessage colSpan={columns}>加载中…</TableMessage>}
            {fields?.length === 0 && (
              <TableMessage colSpan={columns}>还没有自定义字段</TableMessage>
            )}
            {fields?.map((field) => (
              <TableRow key={field.id}>
                <TableCell className="font-medium">{field.label}</TableCell>
                <TableCell className="font-mono text-xs">{field.key}</TableCell>
                <TableCell>{CUSTOM_FIELD_TYPES[field.type]}</TableCell>
                <TableCell>{field.required && <Badge variant="secondary">必填</Badge>}</TableCell>
                <TableCell>{field.showInList ? '显示' : '—'}</TableCell>
                <TableCell>{field.dictionary?.name ?? '—'}</TableCell>
                <TableCell className="text-right tabular-nums">{field.sort}</TableCell>
                {canUpdate && (
                  <TableCell>
                    <div className="flex gap-1">
                      <Button variant="ghost" size="sm" onClick={() => onEdit(field)}>
                        编辑
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive"
                        onClick={() => onRemove(field)}
                      >
                        删除
                      </Button>
                    </div>
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </>
  );
}

interface FieldDialogProps {
  entity: CustomFieldEntity;
  field: CustomField | null;
  onClosed: () => void;
}

function FieldDialog({ entity, field, onClosed }: FieldDialogProps) {
  const queryClient = useQueryClient();
  const dialog = useMountedDialog(onClosed);
  // Free text unless chosen otherwise: most fields are filled in, not picked.
  const [type, setType] = useState<CustomFieldType | null>(field?.type ?? 'TEXT');
  const [dictionaryId, setDictionaryId] = useState<string | null>(field?.dictionary?.id ?? null);
  const [required, setRequired] = useState(field?.required ?? false);
  const [showInList, setShowInList] = useState(field?.showInList ?? false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const mutation = useMutation({
    mutationFn: (save: () => Promise<unknown>) => save(),
    onSuccess: async () => {
      await refreshCustomFields(queryClient);
      dialog.close();
    },
  });
  const selectType = type !== null && isSelectType(type);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const sort = form.get('sort');
    const fields = {
      label: form.get('label'),
      required,
      showInList,
      sort: sort === '' || sort === null ? undefined : Number(sort),
    };
    if (field) {
      const input = parseForm(
        updateCustomFieldSchema,
        {
          ...fields,
          ...(isSelectType(field.type) && dictionaryId !== null ? { dictionaryId } : {}),
        },
        setErrors,
      );
      if (input) {
        mutation.mutate(() => updateCustomField(field.id, input));
      }
    } else {
      const input = parseForm(
        createCustomFieldSchema,
        {
          ...fields,
          entity,
          key: form.get('key'),
          type: type ?? undefined,
          dictionaryId: selectType ? dictionaryId : null,
        },
        setErrors,
      );
      if (input) {
        mutation.mutate(() => createCustomField(input));
      }
    }
  }

  return (
    <FormDialog
      {...dialog.rootProps(mutation.isPending)}
      title={field ? '编辑字段' : `给${CUSTOM_FIELD_ENTITIES[entity].name}新增字段`}
      description={
        field
          ? '说明：标识和类型创建后不能修改。'
          : '标识和类型创建后不能修改。字段按排序号从小到大排列。'
      }
      error={mutation.error}
      pending={mutation.isPending}
      onSubmit={handleSubmit}
    >
      {field ? (
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div className="space-y-1">
            <div className="text-muted-foreground">标识</div>
            <div className="font-mono">{field.key}</div>
          </div>
          <div className="space-y-1">
            <div className="text-muted-foreground">类型</div>
            <div>{CUSTOM_FIELD_TYPES[field.type]}</div>
          </div>
        </div>
      ) : (
        <TextField
          name="key"
          label="字段标识"
          autoComplete="off"
          className="font-mono"
          hint="记录按它保存值，只能用字母、数字和下划线，以字母开头"
          error={errors['key']}
        />
      )}
      <TextField
        name="label"
        label="字段名称"
        autoComplete="off"
        defaultValue={field?.label}
        error={errors['label']}
      />
      {!field && (
        <SelectField
          id="type"
          label="类型"
          options={TYPE_OPTIONS}
          value={type}
          onValueChange={setType}
          placeholder="选择字段类型"
          error={errors['type']}
        />
      )}
      {type && (
        <p className="-mt-2 text-xs text-muted-foreground">
          {field && `类型：${CUSTOM_FIELD_TYPES[type]}。`}
          {TYPE_HINTS[type]}
          {isSelectType(type) && '选项在「数据字典」里维护。'}
        </p>
      )}
      {selectType && (
        <DictionarySelect
          value={dictionaryId}
          onValueChange={setDictionaryId}
          error={errors['dictionaryId']}
        />
      )}
      <div className="flex flex-wrap gap-6">
        <Label className="font-normal">
          <Checkbox checked={required} onCheckedChange={(checked) => setRequired(checked)} />
          必填
        </Label>
        <Label className="font-normal">
          <Checkbox checked={showInList} onCheckedChange={(checked) => setShowInList(checked)} />
          在列表中显示
        </Label>
      </div>
      <TextField
        name="sort"
        label="排序号"
        type="number"
        min={0}
        max={9999}
        defaultValue={field?.sort ?? 0}
        error={errors['sort']}
      />
    </FormDialog>
  );
}

interface DictionarySelectProps {
  value: string | null;
  onValueChange: (value: string | null) => void;
  error: string | undefined;
}

/** Picking a dictionary means reading them all, which takes the dictionary page permission. */
function DictionarySelect(props: DictionarySelectProps) {
  return (
    <Can
      code="system:dictionary"
      fallback={
        <div className="space-y-1">
          <p className="text-sm text-muted-foreground">
            选择数据字典需要「数据字典」页面的权限，请联系管理员授予，或让有权限的人来设置。
          </p>
          <FieldError message={props.error} />
        </div>
      }
    >
      <DictionaryOptions {...props} />
    </Can>
  );
}

function DictionaryOptions({ value, onValueChange, error }: DictionarySelectProps) {
  const { data: dictionaries, error: loadError } = useQuery(dictionariesQuery);
  return (
    <>
      <ErrorAlert error={loadError} />
      <SelectField
        id="dictionaryId"
        label="数据字典"
        options={(dictionaries ?? []).map((dictionary) => ({
          value: dictionary.id,
          label: dictionary.name,
        }))}
        value={value}
        onValueChange={onValueChange}
        placeholder={dictionaries ? '选择提供选项的数据字典' : '加载中…'}
        error={error}
      />
    </>
  );
}
