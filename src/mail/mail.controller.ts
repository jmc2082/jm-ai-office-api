import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Logger,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { Public } from '../auth/public.decorator.js';
import {
  MAIL_PROVIDERS,
  MAIL_VERDICTS,
  type MailProviderKind,
  type MailVerdict,
} from '../db/schema.js';
import { ConnectMailboxDto } from './dto/connect-mailbox.dto.js';
import { MailOAuthService } from './mail-oauth.service.js';
import { MailService } from './mail.service.js';

const parseProvider = (p: string): MailProviderKind => {
  if (!MAIL_PROVIDERS.includes(p as MailProviderKind))
    throw new BadRequestException(`Unknown provider "${p}"`);
  return p as MailProviderKind;
};

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const page = (title: string, body: string) =>
  `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><body style="font-family:system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem;line-height:1.5"><h1 style="font-size:1.25rem">${escapeHtml(title)}</h1><p>${escapeHtml(body)}</p></body>`;

@ApiTags('mail')
@Controller('mail')
export class MailController {
  private readonly logger = new Logger(MailController.name);

  constructor(
    private readonly mail: MailService,
    private readonly oauth: MailOAuthService,
  ) {}

  @Get('mailboxes')
  mailboxes() {
    return { enabled: this.mail.enabled, mailboxes: this.mail.list() };
  }

  /** Returns the provider sign-in URL; open it in the browser. */
  @Post('connect/:provider')
  connect(@Param('provider') provider: string, @Body() dto: ConnectMailboxDto) {
    return this.oauth.start(parseProvider(provider), dto.label ?? null);
  }

  @Delete('mailboxes/:id')
  @HttpCode(204)
  remove(@Param('id', ParseIntPipe) id: number) {
    this.mail.remove(id);
  }

  @Get('messages')
  messages(
    @Query('verdict') verdict?: string,
    @Query('limit', new ParseIntPipe({ optional: true })) limit?: number,
    @Query('before', new ParseIntPipe({ optional: true })) before?: number,
  ) {
    const v = MAIL_VERDICTS.includes(verdict as MailVerdict)
      ? (verdict as MailVerdict)
      : undefined;
    return this.mail.messages({ verdict: v, limit, before });
  }

  /**
   * Public: the provider redirects the browser here without our bearer token.
   * Protected by the single-use, 10-minute `state` issued by the authenticated connect route.
   */
  @Public()
  @Get('oauth/callback/:provider')
  async callback(
    @Param('provider') provider: string,
    @Query('state') state: string | undefined,
    @Query('code') code: string | undefined,
    @Query('error') error: string | undefined,
    @Res() res: Response,
  ) {
    res.type('html');
    if (error || !state || !code) {
      res
        .status(400)
        .send(
          page(
            'Mailbox not connected',
            `Sign-in was cancelled or failed${error ? ` (${error})` : ''}.`,
          ),
        );
      return;
    }
    try {
      const box = await this.oauth.finish(parseProvider(provider), state, code);
      res.send(
        page(
          'Mailbox connected',
          `${box.address} is connected. Sift will triage new mail on its next run. You can close this tab.`,
        ),
      );
    } catch (err) {
      const message =
        err instanceof BadRequestException
          ? err.message
          : 'Could not finish sign-in. Check the API logs.';
      if (!(err instanceof BadRequestException))
        this.logger.error('Mailbox OAuth callback failed', err as Error);
      res.status(400).send(page('Mailbox not connected', message));
    }
  }
}
