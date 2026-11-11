import { z } from 'zod';
import { userRefSchema } from './crm.js';
import { idSchema } from './id.js';
import { pageQuerySchema } from './pagination.js';

const namedRefSchema = z.object({ id: idSchema, name: z.string() });

const changesSomething = (value: object) => Object.keys(value).length > 0;

/** Extensions of programs and scripts, which can't be uploaded or given to a file. */
export const BLOCKED_EXTENSIONS: ReadonlySet<string> = new Set([
  'apk',
  'app',
  'bash',
  'bat',
  'cmd',
  'com',
  'cpl',
  'deb',
  'dll',
  'dmg',
  'exe',
  'hta',
  'jar',
  'js',
  'jse',
  'lnk',
  'msi',
  'pif',
  'pkg',
  'ps1',
  'psm1',
  'reg',
  'rpm',
  'scr',
  'sh',
  'vbe',
  'vbs',
  'wsf',
  'wsh',
]);

/** The types shown in the browser; everything else is only downloaded. */
export const PREVIEW_MIME_TYPES: ReadonlySet<string> = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'application/pdf',
]);

/** The extension of a file name in lowercase, without the dot; empty when it has none. */
export function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}

export function isBlockedFileName(name: string): boolean {
  return BLOCKED_EXTENSIONS.has(extensionOf(name));
}

// Names only live in the database, but they become file names again on download.
const UNSAFE_NAME = /[\\/:*?"<>|\p{Cc}]/u;

function nameSchema(label: string, max: number) {
  return z
    .string()
    .trim()
    .min(1, `请输入${label}`)
    .max(max, `${label}最多 ${max} 个字`)
    .refine((name) => !UNSAFE_NAME.test(name), `${label}不能包含 \\ / : * ? " < > |`)
    .refine((name) => name !== '.' && name !== '..', `${label}不能是 . 或 ..`);
}

export const folderNameSchema = nameSchema('文件夹名称', 100);

export const fileNameSchema = nameSchema('文件名', 255).refine(
  (name) => !isBlockedFileName(name),
  '不允许使用可执行程序和脚本的扩展名',
);

// Folders

export const fileFolderSchema = z.object({
  id: idSchema,
  parentId: idSchema.nullable(),
  name: z.string(),
  owner: userRefSchema,
  /** The department data scopes go by: the folder's own at the top level, else its parent's. */
  dept: namedRefSchema.nullable(),
  creator: userRefSchema,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type FileFolder = z.infer<typeof fileFolderSchema>;

export const fileFolderDetailSchema = fileFolderSchema.extend({
  /** The folders above it, from the top level down. */
  path: z.array(namedRefSchema),
});
export type FileFolderDetail = z.infer<typeof fileFolderDetailSchema>;

export const fileFolderQuerySchema = z.object({
  /** The folder whose subfolders to list; the top level when left out. */
  parentId: idSchema.optional(),
});
export type FileFolderQuery = z.infer<typeof fileFolderQuerySchema>;

/** Top-level folders belong to their creator; others take their parent's owner and department. */
export const createFileFolderSchema = z.object({
  name: folderNameSchema,
  parentId: idSchema.nullable().default(null),
});
export type CreateFileFolderInput = z.infer<typeof createFileFolderSchema>;

/** Moving takes the new parent's owner and department, for everything inside too. */
export const updateFileFolderSchema = z
  .object({ name: folderNameSchema, parentId: idSchema.nullable() })
  .partial()
  .refine(changesSomething, '至少修改一项');
export type UpdateFileFolderInput = z.infer<typeof updateFileFolderSchema>;

// Files

export const storedFileSchema = z.object({
  id: idSchema,
  name: z.string(),
  folder: namedRefSchema.nullable(),
  /** In bytes. */
  size: z.number().int().nonnegative(),
  mimeType: z.string(),
  /** The current version's number. */
  version: z.number().int().positive(),
  owner: userRefSchema,
  dept: namedRefSchema.nullable(),
  /** Who uploaded the first version. */
  creator: userRefSchema,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type StoredFile = z.infer<typeof storedFileSchema>;

/** How many files the list of those changed last holds. */
export const RECENT_FILES = 10;

export const fileVersionSchema = z.object({
  id: idSchema,
  number: z.number().int().positive(),
  size: z.number().int().nonnegative(),
  mimeType: z.string(),
  uploader: userRefSchema,
  /** The number of the version it was restored from. */
  restoredFrom: z.number().int().positive().nullable(),
  createdAt: z.iso.datetime(),
});
export type FileVersion = z.infer<typeof fileVersionSchema>;

export const fileRefTargetSchema = z.enum(['CUSTOMER']);
export type FileRefTarget = z.infer<typeof fileRefTargetSchema>;

export const fileUsageSchema = z.object({
  type: fileRefTargetSchema,
  id: idSchema,
  name: z.string(),
});
export type FileUsage = z.infer<typeof fileUsageSchema>;

export const storedFileDetailSchema = storedFileSchema.extend({
  /** The folders it sits in, from the top level down. */
  path: z.array(namedRefSchema),
  /** Newest first; the first is the current one. */
  versions: z.array(fileVersionSchema),
  /** The records using it that the user can see. */
  usages: z.array(fileUsageSchema),
  /** How many more records use it, out of the user's sight. */
  hiddenUsages: z.number().int().nonnegative(),
});
export type StoredFileDetail = z.infer<typeof storedFileDetailSchema>;

export const storedFileQuerySchema = pageQuerySchema.extend({
  /** The folder to list; the top level when left out. A keyword searches every folder instead. */
  folderId: idSchema.optional(),
});
export type StoredFileQuery = z.infer<typeof storedFileQuerySchema>;

export const uploadFileQuerySchema = z.object({
  /** The top level when left out. */
  folderId: idSchema.optional(),
});
export type UploadFileQuery = z.infer<typeof uploadFileQuerySchema>;

export const updateStoredFileSchema = z
  .object({ name: fileNameSchema, folderId: idSchema.nullable() })
  .partial()
  .refine(changesSomething, '至少修改一项');
export type UpdateStoredFileInput = z.infer<typeof updateStoredFileSchema>;

export const fileContentQuerySchema = z.object({
  /** Save the file instead of showing it, for the types the browser can show. */
  download: z.stringbool().optional(),
});
export type FileContentQuery = z.infer<typeof fileContentQuerySchema>;

// Shares

export const SHARE_EXPIRY_DAYS = [1, 7, 30] as const;

export const createFileShareSchema = z.object({
  /** Null for a link that never expires. */
  expiresInDays: z
    .union([z.literal(1), z.literal(7), z.literal(30)])
    .nullable()
    .default(7),
  /** Ask for a 4-character code the system makes up. */
  withCode: z.boolean().default(false),
});
export type CreateFileShareInput = z.infer<typeof createFileShareSchema>;

export const fileShareSchema = z.object({
  id: idSchema,
  /** The secret part of the link: /s/{token}. */
  token: z.string(),
  code: z.string().nullable(),
  expiresAt: z.iso.datetime().nullable(),
  accessCount: z.number().int().nonnegative(),
  lastAccessedAt: z.iso.datetime().nullable(),
  creator: userRefSchema,
  createdAt: z.iso.datetime(),
});
export type FileShare = z.infer<typeof fileShareSchema>;

export const publicShareQuerySchema = z.object({
  code: z.string().trim().max(8).optional(),
  download: z.stringbool().optional(),
});
export type PublicShareQuery = z.infer<typeof publicShareQuerySchema>;

/** What a share link shows: nothing about the file until the code is given, if it asks for one. */
export const publicShareSchema = z.object({
  codeRequired: z.boolean(),
  expiresAt: z.iso.datetime().nullable(),
  file: z.object({ name: z.string(), size: z.number().int(), mimeType: z.string() }).nullable(),
});
export type PublicShare = z.infer<typeof publicShareSchema>;

// Attachments

export const attachmentSchema = z.object({
  file: z.object({
    id: idSchema,
    name: z.string(),
    size: z.number().int().nonnegative(),
    mimeType: z.string(),
  }),
  attachedBy: userRefSchema,
  attachedAt: z.iso.datetime(),
});
export type Attachment = z.infer<typeof attachmentSchema>;

export const attachFilesSchema = z.object({
  fileIds: z.array(idSchema).min(1, '请选择文件').max(50, '一次最多添加 50 个文件'),
});
export type AttachFilesInput = z.infer<typeof attachFilesSchema>;
