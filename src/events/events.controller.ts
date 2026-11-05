import {
  Controller,
  Get,
  MessageEvent,
  ParseIntPipe,
  Query,
  Sse,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { interval, map, merge, type Observable } from 'rxjs';
import { EVENT_TYPES, type EventType } from '../db/schema.js';
import { EventsService } from './events.service.js';

@ApiTags('events')
@Controller('events')
export class EventsController {
  constructor(private readonly events: EventsService) {}

  @Get()
  list(
    @Query('limit', new ParseIntPipe({ optional: true })) limit?: number,
    @Query('before', new ParseIntPipe({ optional: true })) before?: number,
    @Query('workerId', new ParseIntPipe({ optional: true })) workerId?: number,
    @Query('type') type?: string,
  ) {
    const t = EVENT_TYPES.includes(type as EventType)
      ? (type as EventType)
      : undefined;
    return this.events.list({ limit, before, workerId, type: t });
  }

  /**
   * Live feed. EventSource can't send headers, so the auth guard also accepts
   * `?access_token=` on this route. A heartbeat every 25s keeps proxies from
   * closing an idle connection.
   */
  @Sse('stream')
  stream(): Observable<MessageEvent> {
    const live = this.events.live$.pipe(
      map((row): MessageEvent => ({
        id: String(row.id),
        type: 'event',
        data: row,
      })),
    );
    const heartbeat = interval(25_000).pipe(
      map((): MessageEvent => ({ type: 'ping', data: { ts: Date.now() } })),
    );
    return merge(live, heartbeat);
  }
}
