import {
  CUSTOMER_LEVEL_LABELS,
  CUSTOMER_STATUS_LABELS,
  contactQuerySchema,
  createCustomerSchema,
  customerQuerySchema,
  type CreateCustomerInput,
  type CustomField,
  type CustomValues,
} from '@fld/shared';
import { HttpException, Injectable, type OnModuleInit } from '@nestjs/common';
import { AuthenticationContext } from '@nestjs/authentication';
import type { Principal } from '../auth/principal.js';
import { CustomFieldsService } from '../custom-fields/custom-fields.service.js';
import { DictionariesService } from '../custom-fields/dictionaries.service.js';
import {
  customCell,
  customFromCell,
  customColumn,
  type CellValue,
} from '../spreadsheets/cells.js';
import {
  SpreadsheetRegistry,
  type ImportRow,
  type RowError,
  type SheetColumn,
} from '../spreadsheets/spreadsheet-registry.js';
import { ContactsService } from './contacts.service.js';
import { CustomersService } from './customers.service.js';

const date = (iso: string | null) => (iso ? new Date(iso) : null);

/** A built-in option by its key (A) or its label (A 重点 / 潜在). */
function optionOf<T extends string>(labels: Record<T, string>, text: string): T | undefined {
  return (Object.keys(labels) as T[]).find(
    (key) => key === text.toUpperCase() || labels[key] === text,
  );
}

const CUSTOMER_COLUMNS: SheetColumn[] = [
  { header: '客户名称', required: true, width: 24, note: '必填，最多 128 字' },
  {
    header: '级别',
    note: `从下拉里选 ${Object.values(CUSTOMER_LEVEL_LABELS).join('、')}；不填为 B`,
    options: Object.values(CUSTOMER_LEVEL_LABELS),
  },
  {
    header: '状态',
    note: `从下拉里选 ${Object.values(CUSTOMER_STATUS_LABELS).join('、')}；不填为潜在`,
    options: Object.values(CUSTOMER_STATUS_LABELS),
  },
  { header: '来源' },
  { header: '行业' },
  { header: '电话', width: 16 },
  { header: '地址', width: 30 },
  { header: '备注', width: 30 },
];

/** The CRM's exports and imports: customers both ways, contacts out. */
@Injectable()
export class CrmSpreadsheets implements OnModuleInit {
  constructor(
    private readonly registry: SpreadsheetRegistry,
    private readonly auth: AuthenticationContext,
    private readonly customers: CustomersService,
    private readonly contacts: ContactsService,
    private readonly customFields: CustomFieldsService,
    private readonly dictionaries: DictionariesService,
  ) {}

  onModuleInit() {
    this.registry.register('crm.customer', {
      exporter: {
        columns: async () => [
          ...CUSTOMER_COLUMNS.map(({ header, width }) => ({ header, width })),
          { header: '负责人' },
          { header: '部门' },
          { header: '最近跟进', width: 18 },
          { header: '下次跟进', width: 18 },
          { header: '创建时间', width: 18 },
          ...(await this.customFields.fieldsOf('crm.customer')).map((field) => ({
            header: field.label,
          })),
        ],
        rows: (query) => this.customerRows(query),
      },
      importer: {
        columns: () => this.customerImportColumns(),
        import: (rows) => this.importCustomers(rows),
      },
    });
    this.registry.register('crm.contact', {
      exporter: {
        columns: async () => [
          { header: '姓名' },
          { header: '客户', width: 24 },
          { header: '职务' },
          { header: '电话', width: 16 },
          { header: '邮箱', width: 24 },
          { header: '主联系人' },
          { header: '备注', width: 30 },
          ...(await this.customFields.fieldsOf('crm.contact')).map((field) => ({
            header: field.label,
          })),
        ],
        rows: (query) => this.contactRows(query),
      },
    });
  }

  private get user(): Principal {
    return this.auth.requireUser() as Principal;
  }

  private async *customerRows(query: Record<string, unknown>): AsyncIterable<CellValue[][]> {
    const user = this.user;
    const filter = customerQuerySchema.parse(query);
    const [fields, sources] = await Promise.all([
      this.customFields.fieldsOf('crm.customer'),
      this.dictionaries.items(user, 'crm.customer-source'),
    ]);
    const sourceLabel = (value: string | null) =>
      value && (sources.find((item) => item.value === value)?.label ?? value);
    for await (const batch of this.customers.each(user, filter)) {
      yield batch.map((customer) => [
        customer.name,
        CUSTOMER_LEVEL_LABELS[customer.level],
        CUSTOMER_STATUS_LABELS[customer.status],
        sourceLabel(customer.source),
        customer.industry,
        customer.phone,
        customer.address,
        customer.remark,
        customer.owner.displayName,
        customer.dept?.name ?? null,
        date(customer.lastFollowUpAt),
        date(customer.nextFollowUpAt),
        date(customer.createdAt),
        ...fields.map((field) => customCell(field, customer.custom[field.key])),
      ]);
    }
  }

  private async *contactRows(query: Record<string, unknown>): AsyncIterable<CellValue[][]> {
    const user = this.user;
    const filter = contactQuerySchema.parse(query);
    const fields = await this.customFields.fieldsOf('crm.contact');
    for await (const batch of this.contacts.each(user, filter)) {
      yield batch.map((contact) => [
        contact.name,
        contact.customer.name,
        contact.title,
        contact.phone,
        contact.email,
        contact.primary ? '是' : '否',
        contact.remark,
        ...fields.map((field) => customCell(field, contact.custom[field.key])),
      ]);
    }
  }

  private async customerImportColumns(): Promise<SheetColumn[]> {
    const [fields, sources] = await Promise.all([
      this.customFields.fieldsOf('crm.customer'),
      this.dictionaries.items(this.user, 'crm.customer-source'),
    ]);
    const enabled = sources.filter((item) => item.enabled).map((item) => item.label);
    return [
      ...CUSTOMER_COLUMNS.map((column) =>
        column.header === '来源'
          ? { ...column, note: `选一个：${enabled.join('、')}`, options: enabled }
          : column,
      ),
      ...fields.map(customColumn),
    ];
  }

  /** Every row checked first; then all of them saved, in one statement, or none. */
  private async importCustomers(
    rows: readonly ImportRow[],
  ): Promise<{ count: number } | { errors: RowError[] }> {
    const user = this.user;
    const [fields, sources] = await Promise.all([
      this.customFields.fieldsOf('crm.customer'),
      this.dictionaries.items(user, 'crm.customer-source'),
    ]);
    const inputs: (CreateCustomerInput & { custom: CustomValues })[] = [];
    const errors: RowError[] = [];
    for (const { row, cells } of rows) {
      const problems: string[] = [];
      const text = (header: string) => cells[header] ?? '';
      const level = text('级别') ? optionOf(CUSTOMER_LEVEL_LABELS, text('级别')) : 'B';
      const status = text('状态') ? optionOf(CUSTOMER_STATUS_LABELS, text('状态')) : 'POTENTIAL';
      if (!level) problems.push(`级别没有“${text('级别')}”`);
      if (!status) problems.push(`状态没有“${text('状态')}”`);
      let source: string | null = null;
      if (text('来源')) {
        const item = sources.find(
          (option) =>
            option.enabled && (option.label === text('来源') || option.value === text('来源')),
        );
        if (item) source = item.value;
        else problems.push(`来源没有“${text('来源')}”这个选项`);
      }
      const base = createCustomerSchema.safeParse({
        name: text('客户名称'),
        level: level ?? 'B',
        status: status ?? 'POTENTIAL',
        source,
        industry: text('行业'),
        phone: text('电话'),
        address: text('地址'),
        remark: text('备注'),
      });
      if (!base.success) {
        problems.push(...base.error.issues.map((issue) => issue.message));
      }
      const custom = await this.customValues(fields, cells, problems);
      if (problems.length > 0) {
        errors.push({ row, message: problems.join('；') });
      } else if (base.success && custom) {
        inputs.push({ ...base.data, custom });
      }
    }
    if (errors.length > 0) {
      return { errors };
    }
    return { count: await this.customers.createChecked(user, inputs) };
  }

  private async customValues(
    fields: CustomField[],
    cells: Readonly<Record<string, string>>,
    problems: string[],
  ): Promise<CustomValues | undefined> {
    const values: CustomValues = {};
    for (const field of fields) {
      const parsed = customFromCell(field, cells[field.label] ?? '');
      if ('error' in parsed) problems.push(parsed.error);
      else values[field.key] = parsed.value;
    }
    try {
      return await this.customFields.values('crm.customer', values, {}, { creating: true });
    } catch (error) {
      if (error instanceof HttpException) {
        problems.push(error.message);
        return undefined;
      }
      throw error;
    }
  }
}
