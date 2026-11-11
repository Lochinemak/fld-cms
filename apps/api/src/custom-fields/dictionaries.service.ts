import {
  BUILTIN_DICTIONARIES,
  CUSTOM_FIELD_ENTITIES,
  type BuiltinDictionaryCode,
  type CreateDictionaryInput,
  type CreateDictionaryItemInput,
  type CustomFieldEntity,
  type Dictionary,
  type DictionaryItem,
  type UpdateDictionaryInput,
  type UpdateDictionaryItemInput,
} from '@fld/shared';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditService, changesOf } from '../audit/audit.service.js';
import type { Principal } from '../auth/principal.js';
import { TENANT_PRISMA, tenantIdOf, type TenantPrisma } from '../authz/tenant-prisma.js';
import { Prisma } from '../generated/prisma/client.js';
import { SnowflakeService } from '../snowflake/snowflake.service.js';

export const itemSelect = {
  id: true,
  value: true,
  label: true,
  sort: true,
  enabled: true,
} satisfies Prisma.DictionaryItemSelect;

const itemOrder = [
  { sort: 'asc' },
  { id: 'asc' },
] satisfies Prisma.DictionaryItemOrderByWithRelationInput[];

export function toItem(
  row: Prisma.DictionaryItemGetPayload<{ select: typeof itemSelect }>,
): DictionaryItem {
  return { ...row, id: row.id.toString() };
}

const dictionarySelect = {
  id: true,
  code: true,
  name: true,
  builtin: true,
  items: { select: itemSelect, orderBy: itemOrder },
  fields: { select: { entity: true, label: true }, orderBy: { id: 'asc' } },
} satisfies Prisma.DictionarySelect;

function toDictionary(
  row: Prisma.DictionaryGetPayload<{ select: typeof dictionarySelect }>,
): Dictionary {
  return {
    id: row.id.toString(),
    code: row.code,
    name: row.name,
    builtin: row.builtin,
    items: row.items.map(toItem),
    usedBy: row.fields.map((field) => ({
      entity: field.entity,
      label: `${CUSTOM_FIELD_ENTITIES[field.entity as CustomFieldEntity]?.name ?? field.entity}·${field.label}`,
    })),
  };
}

/**
 * The tenant's data dictionaries. The built-in ones are created for a tenant, with their default
 * items, the first time anything here needs them.
 */
@Injectable()
export class DictionariesService {
  /** Tenants this process has made the built-in dictionaries for. */
  private readonly ensured = new Set<bigint>();

  constructor(
    @Inject(TENANT_PRISMA) private readonly db: TenantPrisma,
    private readonly snowflake: SnowflakeService,
    private readonly audit: AuditService,
  ) {}

  async list(user: Principal): Promise<Dictionary[]> {
    await this.ensureBuiltins(tenantIdOf(user));
    const rows = await this.db.dictionary.findMany({
      select: dictionarySelect,
      orderBy: [{ builtin: 'desc' }, { id: 'asc' }],
    });
    return rows.map(toDictionary);
  }

  /** A built-in dictionary's items, for the pages offering them. */
  async builtinItems(user: Principal, code: string): Promise<DictionaryItem[]> {
    const builtin = BUILTIN_DICTIONARIES[code as BuiltinDictionaryCode];
    if (!builtin) {
      throw new NotFoundException('数据字典不存在');
    }
    if (
      !user.permissionSet.has(builtin.permission) &&
      !user.permissionSet.has('system:dictionary')
    ) {
      throw new ForbiddenException('没有查看该数据字典的权限');
    }
    await this.ensureBuiltins(tenantIdOf(user));
    const rows = await this.db.dictionaryItem.findMany({
      where: { dictionary: { code } },
      select: itemSelect,
      orderBy: itemOrder,
    });
    return rows.map(toItem);
  }

  /**
   * Refuses a value that isn't an enabled item of the built-in dictionary, unless the record has
   * it already (`stored`): an item disabled since stays on the records that have it.
   */
  async assertValue(
    user: Principal,
    code: BuiltinDictionaryCode,
    value: string | null | undefined,
    stored?: string | null,
  ): Promise<void> {
    if (value === null || value === undefined || value === stored) {
      return;
    }
    await this.ensureBuiltins(tenantIdOf(user));
    const found = await this.db.dictionaryItem.count({
      where: { dictionary: { code }, value, enabled: true },
    });
    if (!found) {
      throw new BadRequestException(`${BUILTIN_DICTIONARIES[code].name}的选项不存在或已停用`);
    }
  }

  async create(user: Principal, input: CreateDictionaryInput): Promise<Dictionary> {
    const tenantId = tenantIdOf(user);
    await this.ensureBuiltins(tenantId);
    const id = this.snowflake.next();
    try {
      await this.db.dictionary.create({
        data: { id, tenantId, code: input.code, name: input.name },
        select: { id: true },
      });
    } catch (error) {
      throw conflictOn(error, '编码已被使用');
    }
    await this.audit.record({
      action: 'dictionary.create',
      target: { type: 'dictionary', id, name: input.name },
    });
    return this.read(id);
  }

  async update(user: Principal, id: string, input: UpdateDictionaryInput): Promise<Dictionary> {
    const before = await this.find(id);
    await this.db.dictionary.update({
      where: { id: before.id },
      data: { name: input.name },
      select: { id: true },
    });
    await this.record(before.id, input.name, changesOf([['名称', before.name, input.name]]));
    return this.read(before.id);
  }

  /** Deletes a dictionary of the tenant's own that no field uses. */
  async remove(user: Principal, id: string): Promise<void> {
    const dictionary = await this.find(id);
    if (dictionary.builtin) {
      throw new BadRequestException('内置的数据字典不能删除');
    }
    if (await this.db.customField.count({ where: { dictionaryId: dictionary.id } })) {
      throw new ConflictException('还有自定义字段在用这个数据字典，先改掉或删除那些字段');
    }
    await this.db.dictionary.delete({ where: { id: dictionary.id } });
    await this.audit.record({
      action: 'dictionary.delete',
      target: { type: 'dictionary', id: dictionary.id, name: dictionary.name },
    });
  }

  async addItem(
    user: Principal,
    dictionaryId: string,
    input: CreateDictionaryItemInput,
  ): Promise<Dictionary> {
    const dictionary = await this.find(dictionaryId);
    const id = this.snowflake.next();
    const value = input.value ?? id.toString();
    try {
      await this.db.dictionaryItem.create({
        data: {
          id,
          tenantId: tenantIdOf(user),
          dictionaryId: dictionary.id,
          value,
          label: input.label,
          sort: input.sort,
        },
        select: { id: true },
      });
    } catch (error) {
      throw conflictOn(error, '这个值已经有了');
    }
    await this.record(dictionary.id, dictionary.name, changesOf([['新增选项', null, input.label]]));
    return this.read(dictionary.id);
  }

  /** Renames, reorders, disables or enables an item. Items aren't deleted: records hold them. */
  async updateItem(
    user: Principal,
    dictionaryId: string,
    itemId: string,
    input: UpdateDictionaryItemInput,
  ): Promise<Dictionary> {
    const dictionary = await this.find(dictionaryId);
    const item = await this.db.dictionaryItem.findFirst({
      where: { id: BigInt(itemId), dictionaryId: dictionary.id },
      select: itemSelect,
    });
    if (!item) {
      throw new NotFoundException('选项不存在');
    }
    await this.db.dictionaryItem.update({
      where: { id: item.id },
      data: input,
      select: { id: true },
    });
    const state = (enabled: boolean) => (enabled ? '启用' : '停用');
    await this.record(
      dictionary.id,
      dictionary.name,
      changesOf([
        [`选项「${item.label}」的名称`, item.label, input.label ?? item.label],
        [`选项「${item.label}」的排序`, item.sort, input.sort ?? item.sort],
        [`选项「${item.label}」`, state(item.enabled), state(input.enabled ?? item.enabled)],
      ]),
    );
    return this.read(dictionary.id);
  }

  /** Makes the built-in dictionaries the tenant lacks, with their items. Idempotent. */
  async ensureBuiltins(tenantId: bigint): Promise<void> {
    if (this.ensured.has(tenantId)) {
      return;
    }
    for (const [code, builtin] of Object.entries(BUILTIN_DICTIONARIES)) {
      // Racing instances both get here: the unique (tenant, code) and (dictionary, value) keep one.
      await this.db.dictionary.createMany({
        data: [{ id: this.snowflake.next(), tenantId, code, name: builtin.name, builtin: true }],
        skipDuplicates: true,
      });
      const { id: dictionaryId } = await this.db.dictionary.findUniqueOrThrow({
        where: { tenantId_code: { tenantId, code } },
        select: { id: true },
      });
      await this.db.dictionaryItem.createMany({
        data: builtin.items.map((item, sort) => ({
          id: this.snowflake.next(),
          tenantId,
          dictionaryId,
          value: item.value,
          label: item.label,
          sort,
        })),
        skipDuplicates: true,
      });
    }
    this.ensured.add(tenantId);
  }

  private async find(id: string) {
    const dictionary = await this.db.dictionary.findFirst({
      where: { id: BigInt(id) },
      select: { id: true, name: true, builtin: true },
    });
    if (!dictionary) {
      throw new NotFoundException('数据字典不存在');
    }
    return dictionary;
  }

  private async read(id: bigint): Promise<Dictionary> {
    return toDictionary(
      await this.db.dictionary.findUniqueOrThrow({ where: { id }, select: dictionarySelect }),
    );
  }

  private async record(id: bigint, name: string, changes: ReturnType<typeof changesOf>) {
    if (changes.length > 0) {
      await this.audit.record({
        action: 'dictionary.update',
        target: { type: 'dictionary', id, name },
        changes,
      });
    }
  }
}

/** A unique-key clash as a 409 saying what was taken; anything else as it was. */
export function conflictOn(error: unknown, message: string): unknown {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'
    ? new ConflictException(message)
    : error;
}
