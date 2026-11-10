import {
  File,
  FileArchive,
  FileImage,
  FileSpreadsheet,
  FileText,
  type LucideIcon,
  type LucideProps,
} from 'lucide-react';

const ICONS: Record<string, LucideIcon> = {
  'application/pdf': FileText,
  'application/msword': FileText,
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': FileText,
  'application/vnd.ms-powerpoint': FileText,
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': FileText,
  'text/csv': FileSpreadsheet,
  'application/vnd.ms-excel': FileSpreadsheet,
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': FileSpreadsheet,
  'application/zip': FileArchive,
  'application/vnd.rar': FileArchive,
  'application/x-7z-compressed': FileArchive,
  'application/gzip': FileArchive,
};

export function FileIcon({ mimeType, ...props }: LucideProps & { mimeType: string }) {
  const Icon =
    ICONS[mimeType] ??
    (mimeType.startsWith('image/') ? FileImage : mimeType.startsWith('text/') ? FileText : File);
  return <Icon {...props} />;
}
