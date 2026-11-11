import {
  attachmentSchema,
  fileFolderDetailSchema,
  fileFolderSchema,
  fileShareSchema,
  pageSchema,
  PREVIEW_MIME_TYPES,
  publicShareSchema,
  storedFileDetailSchema,
  storedFileSchema,
  type CreateFileFolderInput,
  type CreateFileShareInput,
  type FileFolderDetail,
  type UpdateFileFolderInput,
  type UpdateStoredFileInput,
} from '@fld/shared';
import { keepPreviousData, queryOptions, type QueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { api } from './api';
import { listPath } from './system';

export interface FileListParams {
  page: number;
  /** The folder to list; the top level when left out. */
  folderId?: string;
  /** Searches every folder the user can see instead. */
  keyword?: string;
}

export interface FolderRef {
  id: string;
  name: string;
}

/** The folders from the top level down to the folder itself; empty at the top level. */
export function folderPath(folder: FileFolderDetail | undefined): FolderRef[] {
  return folder ? [...folder.path, { id: folder.id, name: folder.name }] : [];
}

const filePageSchema = pageSchema(storedFileSchema);

/** The folders in a folder, or at the top level for null. */
export const foldersQuery = (parentId: string | null) =>
  queryOptions({
    queryKey: ['files', 'folders', parentId],
    queryFn: () =>
      api(parentId ? `/files/folders?parentId=${parentId}` : '/files/folders', {
        schema: z.array(fileFolderSchema),
      }),
  });

export const folderQuery = (id: string) =>
  queryOptions({
    queryKey: ['files', 'folder', id],
    queryFn: () => api(`/files/folders/${id}`, { schema: fileFolderDetailSchema }),
  });

export const filesQuery = (params: FileListParams) =>
  queryOptions({
    queryKey: ['files', 'list', params],
    queryFn: () => api(listPath('/files', params), { schema: filePageSchema }),
    placeholderData: keepPreviousData,
  });

/** The files uploaded or changed last that the user can see, latest first. */
export const recentFilesQuery = queryOptions({
  queryKey: ['files', 'recent'],
  queryFn: () => api('/files/recent', { schema: z.array(storedFileSchema) }),
});

export const fileQuery = (id: string) =>
  queryOptions({
    queryKey: ['files', 'file', id],
    queryFn: () => api(`/files/${id}`, { schema: storedFileDetailSchema }),
  });

export const sharesQuery = (fileId: string) =>
  queryOptions({
    queryKey: ['files', 'shares', fileId],
    queryFn: () => api(`/files/${fileId}/shares`, { schema: z.array(fileShareSchema) }),
  });

/** Every fetch counts as a visit to the link, so it is fetched once per code tried. */
export const publicShareQuery = (token: string, code: string | undefined) =>
  queryOptions({
    queryKey: ['public-share', token, code],
    queryFn: () =>
      api(`/public/shares/${token}${code ? `?code=${encodeURIComponent(code)}` : ''}`, {
        schema: publicShareSchema,
      }),
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });

export const attachmentsQuery = (customerId: string) =>
  queryOptions({
    queryKey: ['crm', 'attachments', customerId],
    queryFn: () =>
      api(`/crm/customers/${customerId}/attachments`, { schema: z.array(attachmentSchema) }),
  });

export const createFolder = (input: CreateFileFolderInput) =>
  api('/files/folders', { method: 'POST', json: input });

export const updateFolder = (id: string, input: UpdateFileFolderInput) =>
  api(`/files/folders/${id}`, { method: 'PATCH', json: input });

export const deleteFolder = (id: string) => api(`/files/folders/${id}`, { method: 'DELETE' });

export const updateFile = (id: string, input: UpdateStoredFileInput) =>
  api(`/files/${id}`, { method: 'PATCH', json: input });

export const deleteFile = (id: string) => api(`/files/${id}`, { method: 'DELETE' });

export const restoreVersion = (fileId: string, versionId: string) =>
  api(`/files/${fileId}/versions/${versionId}/restore`, { method: 'POST' });

export const createShare = (fileId: string, input: CreateFileShareInput) =>
  api(`/files/${fileId}/shares`, { method: 'POST', json: input, schema: fileShareSchema });

export const deleteShare = (id: string) => api(`/files/shares/${id}`, { method: 'DELETE' });

export const attachFiles = (customerId: string, fileIds: string[]) =>
  api(`/crm/customers/${customerId}/attachments`, { method: 'POST', json: { fileIds } });

export const detachFile = (customerId: string, fileId: string) =>
  api(`/crm/customers/${customerId}/attachments/${fileId}`, { method: 'DELETE' });

/** Where to post a new file: into the folder, or the uploader's top level for null. */
export const uploadPath = (folderId: string | null) =>
  folderId ? `/files?folderId=${folderId}` : '/files';

/** Where to post a file's new version. */
export const versionUploadPath = (fileId: string) => `/files/${fileId}/versions`;

function withQuery(path: string, query: Record<string, string | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value) {
      search.set(key, value);
    }
  }
  return search.size > 0 ? `${path}?${search}` : path;
}

/** The browser shows what it can preview at these addresses and downloads the rest. */
export const fileContentUrl = (fileId: string, download = false) =>
  withQuery(`/api/files/${fileId}/content`, { download: download ? 'true' : undefined });

export const versionContentUrl = (fileId: string, versionId: string) =>
  `/api/files/${fileId}/versions/${versionId}/content?download=true`;

export const attachmentContentUrl = (customerId: string, fileId: string, download = false) =>
  withQuery(`/api/crm/customers/${customerId}/attachments/${fileId}/content`, {
    download: download ? 'true' : undefined,
  });

export const publicContentUrl = (token: string, code: string | undefined, download = false) =>
  withQuery(`/api/public/shares/${token}/content`, {
    code,
    download: download ? 'true' : undefined,
  });

/** The page a share link opens, for anyone to visit. */
export const shareLink = (token: string) => `${window.location.origin}/s/${token}`;

export const canPreview = (mimeType: string) => PREVIEW_MIME_TYPES.has(mimeType);

/**
 * Refetches after a change. Changes ripple: moving a folder hands over all inside it, and deleting
 * a file takes its links with it. Customers' attachments show the same files.
 */
export function refreshFiles(queryClient: QueryClient): Promise<unknown> {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: ['files'] }),
    queryClient.invalidateQueries({ queryKey: ['crm', 'attachments'] }),
  ]);
}

const SIZE_UNITS = ['KB', 'MB', 'GB', 'TB'];

/** A size in bytes as people read it, such as "1.5 MB". */
export function formatSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < SIZE_UNITS.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${SIZE_UNITS[unit]}`;
}
