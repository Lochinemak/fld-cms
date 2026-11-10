import { Controller, Get } from '@nestjs/common';
import { Public } from '@nestjs/authentication';
import { ApiTags } from '@nestjs/swagger';
import { HealthCheck, HealthCheckService, PrismaHealthIndicator } from '@nestjs/terminus';
import { SkipThrottle } from '@nestjs/throttler';
import { PrismaService } from '../prisma/prisma.service.js';
import { RedisHealthIndicator } from './redis.health.js';

@ApiTags('health')
@Public()
@SkipThrottle()
@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly prismaHealth: PrismaHealthIndicator,
    private readonly redisHealth: RedisHealthIndicator,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  @HealthCheck()
  check() {
    return this.health.check([
      () => this.prismaHealth.pingCheck('database', this.prisma).withTimeout(1000),
      () => this.redisHealth.pingCheck('redis').withTimeout(1000),
    ]);
  }
}
