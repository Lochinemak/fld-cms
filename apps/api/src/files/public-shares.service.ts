import { directoryOf, type PublicShare } from '@fld/shared';
import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { Request, Response } from 'express';
import { PrismaService } from '../prisma/prisma.service.js';
import { Storage } from '../storage/storage.js';
import { sendFileContent } from './file-content.js';

/** The module share links are part of: none of a tenant without it works. */
const FILES_MODULE = directoryOf('file:library:share');

/**
 * Share links as their visitors see them, without signing in. A link works until it expires or
 * is revoked, its file is deleted, or its tenant is disabled or goes without the module.
 */
@Injectable()
export class PublicSharesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: Storage,
  ) {}

  /** What the link shows; nothing about the file before the code, if it asks for one. */
  async open(token: string, code: string | undefined): Promise<PublicShare> {
    const share = await this.find(token);
    const expiresAt = share.expiresAt?.toISOString() ?? null;
    if (share.code && code === undefined) {
      return { codeRequired: true, expiresAt, file: null };
    }
    checkCode(share.code, code);
    await this.prisma.fileShare.update({
      where: { id: share.id },
      data: { accessCount: { increment: 1 }, lastAccessedAt: new Date() },
      select: { id: true },
    });
    const { name, size, mimeType } = share.file;
    return {
      codeRequired: share.code !== null,
      expiresAt,
      file: { name, size: Number(size), mimeType },
    };
  }

  async sendContent(
    token: string,
    code: string | undefined,
    request: Request,
    response: Response,
    download?: boolean,
  ): Promise<void> {
    const share = await this.find(token);
    checkCode(share.code, code);
    await sendFileContent(this.storage, request, response, share.file, download);
  }

  private async find(token: string) {
    const share = await this.prisma.fileShare.findUnique({
      where: { token },
      select: {
        id: true,
        code: true,
        expiresAt: true,
        tenant: { select: { status: true, disabledModules: true } },
        file: {
          select: { name: true, storageKey: true, size: true, mimeType: true, deletedAt: true },
        },
      },
    });
    if (
      !share ||
      share.file.deletedAt ||
      (share.expiresAt && share.expiresAt <= new Date()) ||
      share.tenant.status !== 'ACTIVE' ||
      share.tenant.disabledModules.includes(FILES_MODULE)
    ) {
      throw new NotFoundException('链接不存在或已失效');
    }
    return share;
  }
}

function checkCode(expected: string | null, given: string | undefined): void {
  if (expected !== null && given?.toUpperCase() !== expected) {
    throw new ForbiddenException('提取码不正确');
  }
}
