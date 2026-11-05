import {
  Controller,
  DefaultValuePipe,
  Get,
  ParseIntPipe,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { parseSince } from '../common/since.js';
import { StatsService } from './stats.service.js';

@ApiTags('stats')
@Controller('stats')
export class StatsController {
  constructor(private readonly stats: StatsService) {}

  @Get()
  summary(@Query('since') since?: string) {
    return this.stats.summary(parseSince(since));
  }

  @Get('replay')
  replay(@Query('since') since?: string) {
    return this.stats.replay(parseSince(since));
  }

  @Get('cost')
  cost(@Query('days', new DefaultValuePipe(30), ParseIntPipe) days: number) {
    return this.stats.cost(Math.min(Math.max(days, 1), 365));
  }
}
