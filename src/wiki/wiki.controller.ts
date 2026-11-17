import { Controller, Get, Param } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { WikiService } from './wiki.service.js';

@ApiTags('wiki')
@Controller('wiki')
export class WikiController {
  constructor(private readonly wiki: WikiService) {}

  /** Page list for the dashboard's wiki menu. */
  @Get()
  list() {
    return this.wiki.list();
  }

  /** One page as markdown. Only slugs from the list exist (no file paths). */
  @Get(':slug')
  get(@Param('slug') slug: string) {
    return this.wiki.get(slug);
  }
}
