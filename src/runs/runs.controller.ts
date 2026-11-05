import { Controller, Get, Param, ParseIntPipe, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RUN_STATUSES, type RunStatus } from '../db/schema.js';
import { RunsService } from './runs.service.js';

@ApiTags('runs')
@Controller('runs')
export class RunsController {
  constructor(private readonly runs: RunsService) {}

  @Get()
  list(
    @Query('workerId', new ParseIntPipe({ optional: true })) workerId?: number,
    @Query('status') status?: string,
    @Query('limit', new ParseIntPipe({ optional: true })) limit?: number,
    @Query('before', new ParseIntPipe({ optional: true })) before?: number,
  ) {
    const s = RUN_STATUSES.includes(status as RunStatus)
      ? (status as RunStatus)
      : undefined;
    return this.runs.list({ workerId, status: s, limit, before });
  }

  @Get(':id')
  get(@Param('id', ParseIntPipe) id: number) {
    return this.runs.get(id);
  }
}
