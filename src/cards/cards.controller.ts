import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CARD_STATUSES, type CardStatus } from '../db/schema.js';
import { CardsService } from './cards.service.js';
import { ResolveCardDto } from './dto/resolve-card.dto.js';

@ApiTags('cards')
@Controller('cards')
export class CardsController {
  constructor(private readonly cards: CardsService) {}

  @Get()
  list(
    @Query('status') status?: string,
    @Query('limit', new ParseIntPipe({ optional: true })) limit?: number,
    @Query('before', new ParseIntPipe({ optional: true })) before?: number,
  ) {
    const s = CARD_STATUSES.includes(status as CardStatus)
      ? (status as CardStatus)
      : undefined;
    return this.cards.list({ status: s, limit, before });
  }

  @Get(':id')
  get(@Param('id', ParseIntPipe) id: number) {
    return this.cards.get(id);
  }

  @Post(':id/approve')
  approve(@Param('id', ParseIntPipe) id: number, @Body() dto: ResolveCardDto) {
    return this.cards.approve(id, dto.note);
  }

  @Post(':id/reject')
  reject(@Param('id', ParseIntPipe) id: number, @Body() dto: ResolveCardDto) {
    return this.cards.reject(id, dto.note);
  }
}
