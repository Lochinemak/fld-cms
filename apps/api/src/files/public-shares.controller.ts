import { publicShareQuerySchema, type PublicShare, type PublicShareQuery } from '@fld/shared';
import { Controller, Get, Param, Query, Req, Res } from '@nestjs/common';
import { Public } from '@nestjs/authentication';
import { ApiTags } from '@nestjs/swagger';
import { minutes, Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { PublicSharesService } from './public-shares.service.js';

/** Share links, opened without signing in. Limited per IP address, which also slows code guessing. */
@ApiTags('files')
@Controller('public/shares')
export class PublicSharesController {
  constructor(private readonly shares: PublicSharesService) {}

  @Public()
  @Throttle({ default: { limit: 60, ttl: minutes(15) } })
  @Get(':token')
  open(
    @Param('token') token: string,
    @Query({ schema: publicShareQuerySchema }) query: PublicShareQuery,
  ): Promise<PublicShare> {
    return this.shares.open(token, query.code);
  }

  @Public()
  @Throttle({ default: { limit: 300, ttl: minutes(15) } })
  @Get(':token/content')
  content(
    @Param('token') token: string,
    @Query({ schema: publicShareQuerySchema }) query: PublicShareQuery,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    return this.shares.sendContent(token, query.code, request, response, query.download);
  }
}
