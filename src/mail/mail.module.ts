import { Global, Module } from '@nestjs/common';
import { MailOAuthService } from './mail-oauth.service.js';
import { MailController } from './mail.controller.js';
import { MailService } from './mail.service.js';

/** Global so workers (built in the registry module) can inject MailService. */
@Global()
@Module({
  controllers: [MailController],
  providers: [MailService, MailOAuthService],
  exports: [MailService],
})
export class MailModule {}
