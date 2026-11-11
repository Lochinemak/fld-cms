import type { SpreadsheetEntity } from '@fld/shared';
import { Injectable } from '@nestjs/common';
import type { CellValue } from './cells.js';

export interface SheetColumn {
  header: string;
  /** In characters. */
  width?: number;
  /** For an import template: what to type in it. */
  note?: string;
  required?: boolean;
}

/** A row of an uploaded sheet: its number in the sheet, and its cells by column header. */
export interface ImportRow {
  row: number;
  cells: Readonly<Record<string, string>>;
}

export interface RowError {
  row: number;
  message: string;
}

/**
 * Writes a model's rows. Its methods run as the member who asked, so tenant, permissions and
 * data scope are theirs.
 */
export interface SpreadsheetExporter {
  columns(): Promise<SheetColumn[]>;
  /** The rows the model's list shows for its page's query, a batch at a time. */
  rows(query: Record<string, unknown>): AsyncIterable<CellValue[][]>;
}

/** Reads a model's rows, as the member who asked: all of them, or none. */
export interface SpreadsheetImporter {
  columns(): Promise<SheetColumn[]>;
  /** Checks every row; saves them all when they pass, or nothing and says which rows didn't. */
  import(rows: readonly ImportRow[]): Promise<{ count: number } | { errors: RowError[] }>;
}

/**
 * The exporters and importers of the models in SPREADSHEET_ENTITIES. A model's module registers
 * its own, at start.
 */
@Injectable()
export class SpreadsheetRegistry {
  private readonly exporters = new Map<SpreadsheetEntity, SpreadsheetExporter>();
  private readonly importers = new Map<SpreadsheetEntity, SpreadsheetImporter>();

  register(
    entity: SpreadsheetEntity,
    { exporter, importer }: { exporter?: SpreadsheetExporter; importer?: SpreadsheetImporter },
  ): void {
    if (exporter) this.exporters.set(entity, exporter);
    if (importer) this.importers.set(entity, importer);
  }

  exporter(entity: SpreadsheetEntity): SpreadsheetExporter | undefined {
    return this.exporters.get(entity);
  }

  importer(entity: SpreadsheetEntity): SpreadsheetImporter | undefined {
    return this.importers.get(entity);
  }
}
