import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { parseSince } from '../common/since.js';
import { RunWorkerDto } from './dto/run-worker.dto.js';
import { UpdateWorkerDto } from './dto/update-worker.dto.js';
import { WorkerRunnerService } from './worker-runner.service.js';
import { WorkersService } from './workers.service.js';

@ApiTags('workers')
@Controller('workers')
export class WorkersController {
  constructor(
    private readonly workers: WorkersService,
    private readonly runner: WorkerRunnerService,
  ) {}

  @Get()
  list(@Query('since') since?: string) {
    return this.workers.list(parseSince(since));
  }

  @Get(':idOrSlug')
  get(@Param('idOrSlug') idOrSlug: string, @Query('since') since?: string) {
    return this.workers.get(idOrSlug, parseSince(since));
  }

  @Patch(':idOrSlug')
  update(@Param('idOrSlug') idOrSlug: string, @Body() dto: UpdateWorkerDto) {
    return this.workers.update(idOrSlug, dto);
  }

  /** "Run now". Manual runs ignore the enabled flag. */
  @Post(':idOrSlug/run')
  run(@Param('idOrSlug') idOrSlug: string, @Body() dto: RunWorkerDto) {
    const w = this.workers.find(idOrSlug);
    return this.runner.enqueue(w.slug, 'manual', dto.input ?? null);
  }
}
