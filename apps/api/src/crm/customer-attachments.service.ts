import type { AttachFilesInput, Attachment } from '@fld/shared';
import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { Request, Response } from 'express';
import type { Principal } from '../auth/principal.js';
import { TENANT_PRISMA, tenantIdOf, type TenantPrisma } from '../authz/tenant-prisma.js';
import { sendFileContent } from '../files/file-content.js';
import { FileRefsService, type FileRefTargetRef } from '../files/file-refs.service.js';
import { Storage } from '../storage/storage.js';
import { lockCustomer, requireVisibleCustomer } from './crm-scope.js';

export function customerTarget(customerId: bigint): FileRefTargetRef {
  return { type: 'CUSTOMER', id: customerId };
}

/**
 * Files of the library attached to a customer. Whoever sees the customer can open them, even
 * files outside their own data scope; removing one only takes it off the customer.
 */
@Injectable()
export class CustomerAttachmentsService {
  constructor(
    @Inject(TENANT_PRISMA) private readonly db: TenantPrisma,
    private readonly refs: FileRefsService,
    private readonly storage: Storage,
  ) {}

  async list(user: Principal, id: string): Promise<Attachment[]> {
    const customerId = await requireVisibleCustomer(this.db, user, id);
    return this.refs.attachments(customerTarget(customerId));
  }

  /** Attaches files from the user's own data scope. */
  async attach(user: Principal, id: string, { fileIds }: AttachFilesInput): Promise<Attachment[]> {
    const customerId = await requireVisibleCustomer(this.db, user, id);
    await this.db.$transaction(async (tx) => {
      await lockCustomer(tx, tenantIdOf(user), customerId);
      if ((await tx.customer.count({ where: { id: customerId } })) === 0) {
        throw new NotFoundException('客户不存在');
      }
      await this.refs.attach(tx, user, customerTarget(customerId), fileIds.map(BigInt));
    });
    return this.refs.attachments(customerTarget(customerId));
  }

  async detach(user: Principal, id: string, fileId: string): Promise<void> {
    const customerId = await requireVisibleCustomer(this.db, user, id);
    await this.refs.detach(customerTarget(customerId), BigInt(fileId));
  }

  async sendContent(
    user: Principal,
    id: string,
    fileId: string,
    request: Request,
    response: Response,
    download?: boolean,
  ): Promise<void> {
    const customerId = await requireVisibleCustomer(this.db, user, id);
    const content = await this.refs.attachedContent(customerTarget(customerId), BigInt(fileId));
    await sendFileContent(this.storage, request, response, content, download);
  }
}
