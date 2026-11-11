import {
  CUSTOM_FIELD_ENTITIES,
  CUSTOM_FIELD_TYPES,
  customValueError,
  directoryOf,
  isEmptyCustomValue,
  isSelectType,
  type CreateCustomFieldInput,
  type CustomField,
  type CustomFieldEntity,
  type CustomValues,
  type UpdateCustomFieldInput,
} from '@fld/shared';
import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditService, changesOf } from '../audit/audit.service.js';
import type { Principal } from '../auth/principal.js';
import { TENANT_PRISMA, tenantIdOf, type TenantPrisma } from '../authz/tenant-prisma.js';
import type { Prisma } from '../generated/prisma/client.js';
import { SnowflakeService } from '../snowflake/snowflake.service.js';
import { conflictOn, itemSelect, toItem } from './dictionaries.service.js';

const fieldSelect = {
  id: true,
  entity: true,
  key: true,
  label: true,
  type: true,
  required: true,
  showInList: true,
  sort: true,
  dictionary: {
    select: {
      id: true,
      name: true,
      items: { select: itemSelect, orderBy: [{ sort: 'asc' }, { id: 'asc' }] },
    },
  },
} satisfies Prisma.CustomFieldSelect;

function toField(row: Prisma.CustomFieldGetPayload<{ select: typeof fieldSelect }>): CustomField {
  return {
    id: row.id.toString(),
    entity: row.entity as CustomFieldEntity,
    key: row.key,
    label: row.label,
    type: row.type,
    required: row.required,
    showInList: row.showInList,
    sort: row.sort,
    dictionary: row.dictionary && { id: row.dictionary.id.toString(), name: row.dictionary.name },
    options: row.dictionary?.items.map(toItem) ?? [],
  };
}

/** The values a record keeps in its `custom` column. */
export function customOf(value: Prisma.JsonValue): CustomValues {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as CustomValues)
    : {};
}

/**
 * The fields each tenant adds to its models, and checking the values records give them. A model
 * takes them in three steps: a `custom Json @default("{}")` column, an entry in
 * CUSTOM_FIELD_ENTITIES, and `values()` around its create and update.
 */
@Injectable()
export class CustomFieldsService {
  constructor(
    @Inject(TENANT_PRISMA) private readonly db: TenantPrisma,
    private readonly snowflake: SnowflakeService,
    private readonly audit: AuditService,
  ) {}

  /** The model's fields, for whoever sees the model or manages fields. */
  async list(user: Principal, entity: CustomFieldEntity): Promise<CustomField[]> {
    this.requireEntity(user, entity, 'read');
    return this.fieldsOf(entity);
  }

  async create(user: Principal, input: CreateCustomFieldInput): Promise<CustomField> {
    this.requireEntity(user, input.entity, 'manage');
    const dictionaryId = await this.dictionaryFor(input.type, input.dictionaryId);
    const id = this.snowflake.next();
    try {
      await this.db.customField.create({
        data: {
          id,
          tenantId: tenantIdOf(user),
          entity: input.entity,
          key: input.key,
          label: input.label,
          type: input.type,
          required: input.required,
          showInList: input.showInList,
          sort: input.sort,
          dictionaryId,
        },
        select: { id: true },
      });
    } catch (error) {
      throw conflictOn(error, '这个模型已经有同样标识的字段');
    }
    const field = await this.read(id);
    await this.audit.record({
      action: 'custom-field.create',
      target: { type: 'custom-field', id, name: this.name(field) },
      changes: changesOf([['类型', null, CUSTOM_FIELD_TYPES[field.type]]]),
    });
    return field;
  }

  async update(user: Principal, id: string, input: UpdateCustomFieldInput): Promise<CustomField> {
    const before = await this.find(user, id);
    const dictionaryId =
      input.dictionaryId === undefined
        ? undefined
        : await this.dictionaryFor(before.type, input.dictionaryId);
    await this.db.customField.update({
      where: { id: BigInt(id) },
      data: { ...input, dictionaryId },
      select: { id: true },
    });
    const after = await this.read(BigInt(id));
    const yes = (value: boolean) => (value ? '是' : '否');
    const changes = changesOf([
      ['名称', before.label, after.label],
      ['必填', yes(before.required), yes(after.required)],
      ['在列表中显示', yes(before.showInList), yes(after.showInList)],
      ['排序', before.sort, after.sort],
      ['数据字典', before.dictionary?.name, after.dictionary?.name],
    ]);
    if (changes.length > 0) {
      await this.audit.record({
        action: 'custom-field.update',
        target: { type: 'custom-field', id, name: this.name(after) },
        changes,
      });
    }
    return after;
  }

  /** Deletes the field. Records keep their values, for a field with the same key to show again. */
  async remove(user: Principal, id: string): Promise<void> {
    const field = await this.find(user, id);
    await this.db.customField.delete({ where: { id: BigInt(id) } });
    await this.audit.record({
      action: 'custom-field.delete',
      target: { type: 'custom-field', id, name: this.name(field) },
    });
  }

  /**
   * The custom values a record is to keep: `stored` with the fields `input` gives, checked against
   * the model's fields. A null or empty value clears its field; values of deleted fields stay.
   * Creating, every required field must have a value.
   */
  async values(
    entity: CustomFieldEntity,
    input: CustomValues | undefined,
    stored: CustomValues,
    { creating = false } = {},
  ): Promise<CustomValues> {
    if (input === undefined && !creating) {
      return stored;
    }
    const fields = new Map((await this.fieldsOf(entity)).map((field) => [field.key, field]));
    const result: CustomValues = { ...stored };
    const errors: string[] = [];
    const invalid = new Set<string>();
    for (const [key, value] of Object.entries(input ?? {})) {
      const field = fields.get(key);
      if (!field) {
        errors.push(`没有「${key}」这个字段`);
      } else if (isEmptyCustomValue(value)) {
        delete result[key];
      } else {
        const error = customValueError(field, value, stored[key]);
        if (error) {
          errors.push(error);
          invalid.add(key);
        } else {
          result[key] = value;
        }
      }
    }
    for (const field of fields.values()) {
      const given = input !== undefined && Object.hasOwn(input, field.key);
      if (
        field.required &&
        (creating || given) &&
        !invalid.has(field.key) &&
        isEmptyCustomValue(result[field.key])
      ) {
        errors.push(`请填写${field.label}`);
      }
    }
    if (errors.length > 0) {
      throw new BadRequestException(errors.join('；'));
    }
    return result;
  }

  private async fieldsOf(entity: CustomFieldEntity): Promise<CustomField[]> {
    const rows = await this.db.customField.findMany({
      where: { entity },
      select: fieldSelect,
      orderBy: [{ sort: 'asc' }, { id: 'asc' }],
    });
    return rows.map(toField);
  }

  /**
   * Reading takes the model's page or managing fields; managing takes the latter. Either way, the
   * model's module must be on for the tenant.
   */
  private requireEntity(user: Principal, entity: CustomFieldEntity, need: 'read' | 'manage'): void {
    const { permission } = CUSTOM_FIELD_ENTITIES[entity];
    if (user.context?.tenant.disabledModules.includes(directoryOf(permission))) {
      throw new ForbiddenException('该模块已关闭');
    }
    const manages = user.permissionSet.has(
      need === 'manage' ? 'system:custom-field:update' : 'system:custom-field',
    );
    if (!manages && (need === 'manage' || !user.permissionSet.has(permission))) {
      throw new ForbiddenException('没有权限');
    }
  }

  /** The dictionary a select field offers, which must be the tenant's; none for other types. */
  private async dictionaryFor(
    type: CustomField['type'],
    dictionaryId: string | null,
  ): Promise<bigint | null> {
    if (!isSelectType(type)) {
      return null;
    }
    if (dictionaryId === null) {
      throw new BadRequestException('单选和多选字段要选一个数据字典');
    }
    if (!(await this.db.dictionary.count({ where: { id: BigInt(dictionaryId) } }))) {
      throw new BadRequestException('数据字典不存在');
    }
    return BigInt(dictionaryId);
  }

  private async find(user: Principal, id: string): Promise<CustomField> {
    const row = await this.db.customField.findFirst({
      where: { id: BigInt(id) },
      select: fieldSelect,
    });
    if (!row) {
      throw new NotFoundException('字段不存在');
    }
    const field = toField(row);
    this.requireEntity(user, field.entity, 'manage');
    return field;
  }

  private async read(id: bigint): Promise<CustomField> {
    return toField(
      await this.db.customField.findUniqueOrThrow({ where: { id }, select: fieldSelect }),
    );
  }

  private name(field: CustomField): string {
    return `${CUSTOM_FIELD_ENTITIES[field.entity].name}·${field.label}`;
  }
}
