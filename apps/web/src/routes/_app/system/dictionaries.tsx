import {
  CUSTOM_FIELD_ENTITIES,
  createDictionaryItemSchema,
  createDictionarySchema,
  updateDictionaryItemSchema,
  updateDictionarySchema,
  type Dictionary,
  type DictionaryItem,
} from '@fld/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { Plus } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Can } from '@/components/can';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { ErrorAlert } from '@/components/error-alert';
import { FormDialog } from '@/components/form-dialog';
import { PageHeader } from '@/components/page-header';
import { RequirePermission } from '@/components/require-permission';
import { TableMessage } from '@/components/table-message';
import { TextField } from '@/components/text-field';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useMountedDialog } from '@/hooks/use-mounted-dialog';
import { useCan } from '@/lib/auth';
import {
  addDictionaryItem,
  createDictionary,
  deleteDictionary,
  dictionariesQuery,
  refreshCustomFields,
  updateDictionary,
  updateDictionaryItem,
} from '@/lib/custom-fields';
import { optionalText, parseForm, type FieldErrors } from '@/lib/form';
import { cn } from '@/lib/utils';

export const Route = createFileRoute('/_app/system/dictionaries')({
  component: () => (
    <RequirePermission code="system:dictionary">
      <DictionariesPage />
    </RequirePermission>
  ),
});

type DictionaryDialogState = { kind: 'create' } | { kind: 'rename'; dictionary: Dictionary };
type ItemDialogState = { kind: 'create' } | { kind: 'edit'; item: DictionaryItem };

/** Where a dictionary is used: 「客户 · 行业」. */
function usedByLabel(usedBy: Dictionary['usedBy'][number]): string {
  const entity = CUSTOM_FIELD_ENTITIES[usedBy.entity as keyof typeof CUSTOM_FIELD_ENTITIES];
  return entity ? `${entity.name} · ${usedBy.label}` : usedBy.label;
}

function DictionariesPage() {
  const queryClient = useQueryClient();
  const canUpdate = useCan('system:dictionary:update');
  const { data: dictionaries, error, isPending } = useQuery(dictionariesQuery);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DictionaryDialogState | null>(null);
  const [removing, setRemoving] = useState<Dictionary | null>(null);
  const selected =
    dictionaries?.find((dictionary) => dictionary.id === selectedId) ?? dictionaries?.[0] ?? null;
  const columns = canUpdate ? 5 : 4;

  return (
    <div className="space-y-6">
      <PageHeader
        title="数据字典"
        description="单选和多选字段的选项来自这里。选项不能删除，停用后不再出现在下拉里，已经选了它的记录照常显示。"
        actions={
          <Can code="system:dictionary:update">
            <Button onClick={() => setDialog({ kind: 'create' })}>
              <Plus />
              新建字典
            </Button>
          </Can>
        }
      />
      <ErrorAlert error={error} />
      <div className="grid items-start gap-6 xl:grid-cols-[3fr_2fr]">
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>字典名称</TableHead>
                <TableHead>编码</TableHead>
                <TableHead className="text-right">选项数</TableHead>
                <TableHead>使用位置</TableHead>
                {canUpdate && <TableHead className="w-0" />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {isPending && <TableMessage colSpan={columns}>加载中…</TableMessage>}
              {dictionaries?.length === 0 && (
                <TableMessage colSpan={columns}>还没有数据字典</TableMessage>
              )}
              {dictionaries?.map((dictionary) => (
                <TableRow
                  key={dictionary.id}
                  data-state={dictionary.id === selected?.id ? 'selected' : undefined}
                  className="cursor-pointer"
                  onClick={() => setSelectedId(dictionary.id)}
                >
                  <TableCell>
                    <div className="flex items-center gap-2 font-medium">
                      {dictionary.name}
                      {dictionary.builtin && <Badge variant="secondary">内置</Badge>}
                    </div>
                  </TableCell>
                  <TableCell className="font-mono text-xs">{dictionary.code}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {dictionary.items.length}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {dictionary.usedBy.length > 0
                      ? dictionary.usedBy.map(usedByLabel).join('、')
                      : '—'}
                  </TableCell>
                  {canUpdate && (
                    <TableCell>
                      <div className="flex gap-1" onClick={(event) => event.stopPropagation()}>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setDialog({ kind: 'rename', dictionary })}
                        >
                          重命名
                        </Button>
                        {!dictionary.builtin && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-destructive"
                            onClick={() => setRemoving(dictionary)}
                          >
                            删除
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        {selected && <ItemsPanel key={selected.id} dictionary={selected} canUpdate={canUpdate} />}
      </div>
      {dialog && <DictionaryDialog state={dialog} onClosed={() => setDialog(null)} />}
      {removing && (
        <ConfirmDialog
          title={`删除字典「${removing.name}」？`}
          description="删除后不能恢复。还有字段在用这个字典时不能删除，请先删除这些字段或改用其他字典。"
          confirmLabel="删除"
          destructive
          action={async () => {
            await deleteDictionary(removing.id);
            await refreshCustomFields(queryClient);
          }}
          onClosed={() => setRemoving(null)}
        />
      )}
    </div>
  );
}

function ItemsPanel({ dictionary, canUpdate }: { dictionary: Dictionary; canUpdate: boolean }) {
  const queryClient = useQueryClient();
  const [dialog, setDialog] = useState<ItemDialogState | null>(null);
  const toggle = useMutation({
    mutationFn: (item: DictionaryItem) =>
      updateDictionaryItem(dictionary.id, item.id, { enabled: !item.enabled }),
    onSuccess: () => refreshCustomFields(queryClient),
  });
  const items = [...dictionary.items].sort((a, b) => a.sort - b.sort);
  const columns = canUpdate ? 5 : 4;

  return (
    <div className="space-y-3">
      <div className="flex min-h-9 items-center justify-between gap-2">
        <h2 className="font-medium">「{dictionary.name}」的选项</h2>
        {canUpdate && (
          <Button variant="outline" size="sm" onClick={() => setDialog({ kind: 'create' })}>
            <Plus />
            新增选项
          </Button>
        )}
      </div>
      <ErrorAlert error={toggle.error} />
      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>名称</TableHead>
              <TableHead>值</TableHead>
              <TableHead className="text-right">排序</TableHead>
              <TableHead>状态</TableHead>
              {canUpdate && <TableHead className="w-0" />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.length === 0 && <TableMessage colSpan={columns}>还没有选项</TableMessage>}
            {items.map((item) => (
              <TableRow key={item.id}>
                <TableCell className={cn(!item.enabled && 'text-muted-foreground')}>
                  {item.label}
                </TableCell>
                <TableCell className="font-mono text-xs">{item.value}</TableCell>
                <TableCell className="text-right tabular-nums">{item.sort}</TableCell>
                <TableCell>
                  {item.enabled ? (
                    <Badge variant="secondary">启用</Badge>
                  ) : (
                    <Badge variant="outline">已停用</Badge>
                  )}
                </TableCell>
                {canUpdate && (
                  <TableCell>
                    <div className="flex gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setDialog({ kind: 'edit', item })}
                      >
                        编辑
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={toggle.isPending}
                        onClick={() => toggle.mutate(item)}
                      >
                        {item.enabled ? '停用' : '启用'}
                      </Button>
                    </div>
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {dialog && (
        <ItemDialog dictionary={dictionary} state={dialog} onClosed={() => setDialog(null)} />
      )}
    </div>
  );
}

function DictionaryDialog({
  state,
  onClosed,
}: {
  state: DictionaryDialogState;
  onClosed: () => void;
}) {
  const queryClient = useQueryClient();
  const dialog = useMountedDialog(onClosed);
  const renaming = state.kind === 'rename' ? state.dictionary : null;
  const [errors, setErrors] = useState<FieldErrors>({});
  const mutation = useMutation({
    mutationFn: (save: () => Promise<unknown>) => save(),
    onSuccess: async () => {
      await refreshCustomFields(queryClient);
      dialog.close();
    },
  });

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    if (renaming) {
      const input = parseForm(updateDictionarySchema, { name: form.get('name') }, setErrors);
      if (input) {
        mutation.mutate(() => updateDictionary(renaming.id, input));
      }
    } else {
      const input = parseForm(
        createDictionarySchema,
        { code: form.get('code'), name: form.get('name') },
        setErrors,
      );
      if (input) {
        mutation.mutate(() => createDictionary(input));
      }
    }
  }

  return (
    <FormDialog
      {...dialog.rootProps(mutation.isPending)}
      title={renaming ? '重命名字典' : '新建字典'}
      description={
        renaming
          ? `字典的编码「${renaming.code}」不变。`
          : '建好后再给它添加选项，然后在自定义字段里选用它。'
      }
      error={mutation.error}
      pending={mutation.isPending}
      onSubmit={handleSubmit}
    >
      {!renaming && (
        <TextField
          name="code"
          label="编码"
          autoComplete="off"
          className="font-mono"
          hint="创建后不能修改，只能用字母、数字和下划线"
          error={errors['code']}
        />
      )}
      <TextField
        name="name"
        label="名称"
        autoComplete="off"
        defaultValue={renaming?.name}
        error={errors['name']}
      />
    </FormDialog>
  );
}

interface ItemDialogProps {
  dictionary: Dictionary;
  state: ItemDialogState;
  onClosed: () => void;
}

function ItemDialog({ dictionary, state, onClosed }: ItemDialogProps) {
  const queryClient = useQueryClient();
  const dialog = useMountedDialog(onClosed);
  const editing = state.kind === 'edit' ? state.item : null;
  const [errors, setErrors] = useState<FieldErrors>({});
  const mutation = useMutation({
    mutationFn: (save: () => Promise<unknown>) => save(),
    onSuccess: async () => {
      await refreshCustomFields(queryClient);
      dialog.close();
    },
  });

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const sort = form.get('sort');
    const fields = {
      label: form.get('label'),
      sort: sort === '' || sort === null ? undefined : Number(sort),
    };
    if (editing) {
      const input = parseForm(updateDictionaryItemSchema, fields, setErrors);
      if (input) {
        mutation.mutate(() => updateDictionaryItem(dictionary.id, editing.id, input));
      }
    } else {
      const input = parseForm(
        createDictionaryItemSchema,
        { ...fields, value: optionalText(form.get('value')) },
        setErrors,
      );
      if (input) {
        mutation.mutate(() => addDictionaryItem(dictionary.id, input));
      }
    }
  }

  return (
    <FormDialog
      {...dialog.rootProps(mutation.isPending)}
      title={editing ? '编辑选项' : `给「${dictionary.name}」新增选项`}
      description={
        editing
          ? `选项的值「${editing.value}」不变，已经选了它的记录会显示新的名称。`
          : '选项按排序号从小到大排列。'
      }
      error={mutation.error}
      pending={mutation.isPending}
      onSubmit={handleSubmit}
    >
      <TextField
        name="label"
        label="名称"
        autoComplete="off"
        defaultValue={editing?.label}
        error={errors['label']}
      />
      {!editing && (
        <TextField
          name="value"
          label="值（选填）"
          autoComplete="off"
          className="font-mono"
          hint="留空自动生成，记录里存的是它"
          error={errors['value']}
        />
      )}
      <TextField
        name="sort"
        label="排序号"
        type="number"
        min={0}
        max={9999}
        defaultValue={editing?.sort ?? 0}
        error={errors['sort']}
      />
    </FormDialog>
  );
}
