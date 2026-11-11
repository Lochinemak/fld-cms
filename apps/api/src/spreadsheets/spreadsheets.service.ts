import { createReadStream, createWriteStream } from 'node:fs';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import {
  EXPORT_MAX_ROWS,
  IMPORT_MAX_ROWS,
  SPREADSHEET_ENTITIES,
  SPREADSHEET_KEEP_DAYS,
  type CreateExportInput,
  type SpreadsheetEntity,
  type SpreadsheetTask,
} from '@fld/shared';
import { InjectQueue } from '@nestjs/bullmq';
import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { Queue } from 'bullmq';
import ExcelJS from 'exceljs';
import type { Request, Response } from 'express';
import { AuditService } from '../audit/audit.service.js';
import type { Principal } from '../auth/principal.js';
import { RunAsRefusedError, RunAsService } from '../auth/run-as.service.js';
import { TENANT_PRISMA, tenantIdOf, type TenantPrisma } from '../authz/tenant-prisma.js';
import { contentDisposition, sendFileContent } from '../files/file-content.js';
import { removeUpload, type UploadedTempFile } from '../files/upload.js';
import type { Prisma } from '../generated/prisma/client.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { SnowflakeService } from '../snowflake/snowflake.service.js';
import { Storage } from '../storage/storage.js';
import { cellText } from './cells.js';
import { SpreadsheetRegistry, type ImportRow, type SheetColumn } from './spreadsheet-registry.js';

export const SPREADSHEETS_QUEUE = 'spreadsheets';
export const RUN_SPREADSHEET_TASK = 'run';
export const REMOVE_EXPIRED_SPREADSHEETS = 'remove-expired-spreadsheets';

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const DAY = 86_400_000;
/** The rows of a failed import kept to show: enough to fix the file by. */
const ROW_ERRORS_KEPT = 200;

/** A failure to tell the member as it is. */
class TaskFailure extends Error {
  override readonly name = 'TaskFailure';
}

const taskSelect = {
  id: true,
  kind: true,
  entity: true,
  status: true,
  fileName: true,
  storageKey: true,
  rowCount: true,
  error: true,
  rowErrors: true,
  createdAt: true,
  finishedAt: true,
} satisfies Prisma.SpreadsheetTaskSelect;

function toTask(
  row: Prisma.SpreadsheetTaskGetPayload<{ select: typeof taskSelect }>,
): SpreadsheetTask {
  return {
    id: row.id.toString(),
    kind: row.kind,
    entity: row.entity as SpreadsheetEntity,
    status: row.status,
    fileName: row.fileName,
    downloadable: row.kind === 'EXPORT' && row.status === 'DONE' && row.storageKey !== null,
    rowCount: row.rowCount,
    error: row.error,
    rowErrors: Array.isArray(row.rowErrors) ? (row.rowErrors as SpreadsheetTask['rowErrors']) : [],
    createdAt: row.createdAt.toISOString(),
    finishedAt: row.finishedAt?.toISOString() ?? null,
  };
}

const timestamp = () => {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
};

/**
 * Exports to and imports from spreadsheets, as background jobs: each member's own, kept 7 days.
 * The models themselves are registered in SpreadsheetRegistry.
 */
@Injectable()
export class SpreadsheetsService {
  private readonly logger = new Logger(SpreadsheetsService.name);

  constructor(
    @Inject(TENANT_PRISMA) private readonly db: TenantPrisma,
    @InjectQueue(SPREADSHEETS_QUEUE) private readonly queue: Queue,
    private readonly prisma: PrismaService,
    private readonly snowflake: SnowflakeService,
    private readonly registry: SpreadsheetRegistry,
    private readonly storage: Storage,
    private readonly runAs: RunAsService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
  ) {}

  async createExport(user: Principal, input: CreateExportInput): Promise<SpreadsheetTask> {
    const { name, export: permission } = SPREADSHEET_ENTITIES[input.entity];
    this.require(user, permission);
    return this.queueTask(user, {
      kind: 'EXPORT',
      entity: input.entity,
      fileName: `${name}-${timestamp()}.xlsx`,
      query: input.query as Prisma.InputJsonObject,
    });
  }

  async createImport(
    user: Principal,
    entity: SpreadsheetEntity,
    file: UploadedTempFile | undefined,
  ): Promise<SpreadsheetTask> {
    try {
      const definition = SPREADSHEET_ENTITIES[entity];
      if (!('import' in definition)) {
        throw new BadRequestException(`${definition.name}不能导入`);
      }
      this.require(user, definition.import);
      if (!file) {
        throw new BadRequestException('请选择要导入的文件');
      }
      if (!file.originalname.toLowerCase().endsWith('.xlsx')) {
        throw new BadRequestException(
          '只能导入 .xlsx 格式的 Excel 文件，请先用 Excel 另存为 .xlsx',
        );
      }
      const id = this.snowflake.next();
      const storageKey = `spreadsheets/${tenantIdOf(user)}/${id}.xlsx`;
      await this.storage.put(storageKey, file.path, { size: file.size, contentType: XLSX });
      return await this.queueTask(user, {
        id,
        kind: 'IMPORT',
        entity,
        fileName: file.originalname.slice(0, 255),
        storageKey,
        fileSize: BigInt(file.size),
      });
    } finally {
      await removeUpload(file);
    }
  }

  /** The member's exports and imports of the last 7 days, newest first. */
  async list(user: Principal): Promise<SpreadsheetTask[]> {
    const rows = await this.db.spreadsheetTask.findMany({
      where: { userId: BigInt(user.id) },
      select: taskSelect,
      orderBy: { id: 'desc' },
      take: 50,
    });
    return rows.map(toTask);
  }

  async download(user: Principal, id: string, request: Request, response: Response) {
    const task = await this.db.spreadsheetTask.findFirst({
      where: { id: BigInt(id), userId: BigInt(user.id), kind: 'EXPORT', status: 'DONE' },
      select: { fileName: true, storageKey: true, fileSize: true },
    });
    if (!task?.storageKey) {
      throw new NotFoundException('导出文件不存在或已过期');
    }
    await sendFileContent(
      this.storage,
      request,
      response,
      {
        name: task.fileName,
        storageKey: task.storageKey,
        size: task.fileSize ?? 0n,
        mimeType: XLSX,
      },
      true,
    );
  }

  /** A sheet with the import's columns, and a second one saying what goes in each. */
  async sendTemplate(user: Principal, entity: SpreadsheetEntity, response: Response) {
    const definition = SPREADSHEET_ENTITIES[entity];
    const importer = this.registry.importer(entity);
    if (!('import' in definition) || !importer) {
      throw new BadRequestException(`${definition.name}不能导入`);
    }
    this.require(user, definition.import);
    const columns = await importer.columns();
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet(definition.name, FROZEN_HEADER);
    setColumns(sheet, columns);
    columns.forEach((column, index) => {
      if (column.note) {
        sheet.getRow(1).getCell(index + 1).note = column.note;
      }
    });
    const help = workbook.addWorksheet('填写说明');
    help.columns = [
      { header: '列', width: 16 },
      { header: '必填', width: 6 },
      { header: '怎么填', width: 60 },
    ];
    help.getRow(1).font = { bold: true };
    for (const column of columns) {
      help.addRow([column.header, column.required ? '是' : '', column.note ?? '']);
    }
    help.addRow([]);
    help.addRow([`第一行是列名，不要改；从第二行起每行一条，最多 ${IMPORT_MAX_ROWS} 行。`]);
    help.addRow(['只要有一行不对，整个文件都不导入，并列出有问题的行，改好后重新上传。']);
    response.setHeader('Content-Type', XLSX);
    response.setHeader(
      'Content-Disposition',
      contentDisposition('attachment', `${definition.name}导入模板.xlsx`),
    );
    response.setHeader('Cache-Control', 'private, no-store');
    await workbook.xlsx.write(response);
    response.end();
  }

  /** Runs a queued task, as the member who asked, and tells them how it went. */
  async run(taskId: bigint): Promise<void> {
    const task = await this.prisma.spreadsheetTask.findUnique({ where: { id: taskId } });
    if (!task || task.status !== 'PENDING') {
      return;
    }
    await this.prisma.spreadsheetTask.update({
      where: { id: taskId },
      data: { status: 'RUNNING' },
    });
    const entity = task.entity as SpreadsheetEntity;
    const name = SPREADSHEET_ENTITIES[entity].name;
    const exporting = task.kind === 'EXPORT';
    const what = exporting ? `导出${name}` : `导入${name}`;
    try {
      const outcome = await this.runAs.run(task.userId, task.tenantId, () =>
        exporting
          ? this.export(task.id, task.tenantId, entity, task.query)
          : this.import(task, entity),
      );
      await this.prisma.spreadsheetTask.update({
        where: { id: taskId },
        data: { status: 'DONE', finishedAt: new Date(), ...outcome },
      });
      await this.notifications.notify({
        tenantId: task.tenantId,
        userId: task.userId,
        kind: exporting ? 'export' : 'import',
        title: `${what}完成：共 ${outcome.rowCount} 行`,
        body: exporting
          ? `可以下载「${task.fileName}」了，保留 ${SPREADSHEET_KEEP_DAYS} 天。`
          : null,
        link: exporting ? '/spreadsheets' : '/crm/customers',
      });
    } catch (error) {
      const failure = error instanceof TaskFailure || error instanceof RunAsRefusedError;
      if (!failure) {
        this.logger.error(
          `Spreadsheet task ${taskId} failed`,
          error instanceof Error ? error.stack : error,
        );
      }
      const message = failure ? error.message : `${what}失败，请稍后重试`;
      await this.prisma.spreadsheetTask.update({
        where: { id: taskId },
        data: {
          status: 'FAILED',
          finishedAt: new Date(),
          error: message.slice(0, 1000),
          ...(error instanceof ImportRejected && {
            rowErrors: error.rows.slice(0, ROW_ERRORS_KEPT) as unknown as Prisma.InputJsonArray,
          }),
        },
      });
      await this.notifications.notify({
        tenantId: task.tenantId,
        userId: task.userId,
        kind: exporting ? 'export' : 'import',
        title: `${what}失败`,
        body: message,
        link: '/spreadsheets',
      });
    }
  }

  /** Removes the tasks older than SPREADSHEET_KEEP_DAYS before `now`, with their files. */
  async removeExpired(now = new Date()): Promise<number> {
    const before = new Date(now.getTime() - SPREADSHEET_KEEP_DAYS * DAY);
    let removed = 0;
    for (;;) {
      const batch = await this.prisma.spreadsheetTask.findMany({
        where: { createdAt: { lt: before } },
        select: { id: true, storageKey: true },
        take: 100,
      });
      if (batch.length === 0) {
        return removed;
      }
      // The file first: a task whose file couldn't go stays, to be tried again.
      const gone: bigint[] = [];
      for (const task of batch) {
        try {
          if (task.storageKey) await this.storage.remove(task.storageKey);
          gone.push(task.id);
        } catch (error) {
          this.logger.warn(`Could not remove ${task.storageKey}: ${String(error)}`);
        }
      }
      if (gone.length === 0) {
        return removed;
      }
      const { count } = await this.prisma.spreadsheetTask.deleteMany({
        where: { id: { in: gone } },
      });
      removed += count;
    }
  }

  private async export(
    taskId: bigint,
    tenantId: bigint,
    entity: SpreadsheetEntity,
    query: Prisma.JsonValue,
  ): Promise<{ rowCount: number; storageKey: string; fileSize: bigint }> {
    const exporter = this.registry.exporter(entity);
    if (!exporter) {
      throw new TaskFailure('不支持导出这种数据');
    }
    const directory = await mkdtemp(join(tmpdir(), 'fld-export-'));
    const path = join(directory, 'export.xlsx');
    try {
      const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
        filename: path,
        useSharedStrings: true,
        useStyles: true,
      });
      const sheet = workbook.addWorksheet(SPREADSHEET_ENTITIES[entity].name, FROZEN_HEADER);
      setColumns(sheet, await exporter.columns());
      sheet.getRow(1).commit();
      let rowCount = 0;
      const filter =
        typeof query === 'object' && query !== null && !Array.isArray(query) ? query : {};
      for await (const rows of exporter.rows(filter as Record<string, unknown>)) {
        rowCount += rows.length;
        if (rowCount > EXPORT_MAX_ROWS) {
          throw new TaskFailure(`一次最多导出 ${EXPORT_MAX_ROWS} 行，请加上筛选条件再导出`);
        }
        for (const row of rows) {
          sheet.addRow(row).commit();
        }
      }
      await workbook.commit();
      const { size } = await stat(path);
      const storageKey = `spreadsheets/${tenantId}/${taskId}.xlsx`;
      await this.storage.put(storageKey, path, { size, contentType: XLSX });
      await this.audit.record({
        action: 'data.export',
        target: {
          type: 'spreadsheet',
          id: taskId,
          name: `${SPREADSHEET_ENTITIES[entity].name}（${rowCount} 行）`,
        },
      });
      return { rowCount, storageKey, fileSize: BigInt(size) };
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }

  private async import(
    task: { id: bigint; storageKey: string | null; fileName: string },
    entity: SpreadsheetEntity,
  ): Promise<{ rowCount: number }> {
    const importer = this.registry.importer(entity);
    if (!importer || !task.storageKey) {
      throw new TaskFailure('不支持导入这种数据');
    }
    const columns = await importer.columns();
    const rows = await this.readRows(task.storageKey, columns);
    const outcome = await importer.import(rows);
    if ('errors' in outcome) {
      throw new ImportRejected(outcome.errors);
    }
    await this.audit.record({
      action: 'data.import',
      target: {
        type: 'spreadsheet',
        id: task.id,
        name: `${SPREADSHEET_ENTITIES[entity].name}（${outcome.count} 行，${task.fileName}）`,
      },
    });
    return { rowCount: outcome.count };
  }

  /** The rows of the file's first sheet, by the headers of its first row. */
  private async readRows(storageKey: string, columns: SheetColumn[]): Promise<ImportRow[]> {
    const directory = await mkdtemp(join(tmpdir(), 'fld-import-'));
    const path = join(directory, 'import.xlsx');
    try {
      await pipeline(await this.storage.read(storageKey), createWriteStream(path));
      const workbook = new ExcelJS.Workbook();
      try {
        await workbook.xlsx.read(createReadStream(path));
      } catch {
        throw new TaskFailure('文件打不开，请确认是 .xlsx 格式的 Excel 文件');
      }
      const sheet = workbook.worksheets[0];
      if (!sheet) {
        throw new TaskFailure('文件里没有工作表');
      }
      const headers = new Map<number, string>();
      sheet.getRow(1).eachCell((cell, column) => {
        headers.set(column, cellText(cell.value).replace(/\s*\*$/, ''));
      });
      const known = new Set(columns.map((column) => column.header));
      const missing = columns
        .filter((column) => column.required && ![...headers.values()].includes(column.header))
        .map((column) => column.header);
      if (missing.length > 0) {
        throw new TaskFailure(`第一行缺少这些列：${missing.join('、')}。请用下载的模板填写`);
      }
      const rows: ImportRow[] = [];
      sheet.eachRow((row, number) => {
        if (number === 1) return;
        const cells: Record<string, string> = {};
        let empty = true;
        for (const [column, header] of headers) {
          if (!known.has(header)) continue;
          const text = cellText(row.getCell(column).value);
          cells[header] = text;
          empty &&= text === '';
        }
        if (!empty) rows.push({ row: number, cells });
      });
      if (rows.length === 0) {
        throw new TaskFailure('文件里没有要导入的行');
      }
      if (rows.length > IMPORT_MAX_ROWS) {
        throw new TaskFailure(
          `一次最多导入 ${IMPORT_MAX_ROWS} 行，这个文件有 ${rows.length} 行，请分开导入`,
        );
      }
      return rows;
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }

  private async queueTask(
    user: Principal,
    task: Omit<Prisma.SpreadsheetTaskUncheckedCreateInput, 'id' | 'tenantId' | 'userId'> & {
      id?: bigint;
    },
  ): Promise<SpreadsheetTask> {
    const id = task.id ?? this.snowflake.next();
    const row = await this.db.spreadsheetTask.create({
      data: { ...task, id, tenantId: tenantIdOf(user), userId: BigInt(user.id) },
      select: taskSelect,
    });
    // Once: a failure is reported, and the member tries again if they want to.
    await this.queue.add(
      RUN_SPREADSHEET_TASK,
      { taskId: id.toString() },
      {
        jobId: `task-${id}`,
        attempts: 1,
      },
    );
    return toTask(row);
  }

  private require(user: Principal, permission: string): void {
    if (!user.permissionSet.has(permission)) {
      throw new ForbiddenException('没有权限');
    }
  }
}

/** An import none of whose rows were saved, for those at fault. */
class ImportRejected extends TaskFailure {
  constructor(readonly rows: { row: number; message: string }[]) {
    super(`有 ${rows.length} 行不对，没有导入任何数据。改好后重新上传`);
  }
}

function setColumns(sheet: ExcelJS.Worksheet, columns: SheetColumn[]): void {
  sheet.columns = columns.map((column) => ({
    header: column.header,
    width: column.width ?? Math.max(10, column.header.length * 2 + 4),
  }));
  sheet.getRow(1).font = { bold: true };
}

/** The header row stays in view while scrolling. */
const FROZEN_HEADER = { views: [{ state: 'frozen' as const, ySplit: 1 }] };
