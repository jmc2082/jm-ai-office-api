import { Controller, Get, Inject } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { sql } from 'drizzle-orm';
import { Public } from '../auth/public.decorator.js';
import { DB } from '../db/db.module.js';
import type { Db } from '../db/db.js';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(@Inject(DB) private readonly db: Db) {}

  @Public()
  @Get()
  check() {
    this.db.get(sql`select 1`);
    return { ok: true, ts: new Date() };
  }
}
