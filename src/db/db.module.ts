import {
  Global,
  Inject,
  Module,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { openDb } from './db.js';

export const DB = Symbol('DB');
const SQLITE = Symbol('SQLITE');

@Global()
@Module({
  providers: [
    {
      provide: SQLITE,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        openDb(config.getOrThrow<string>('databasePath')),
    },
    {
      provide: DB,
      inject: [SQLITE],
      useFactory: (handle: ReturnType<typeof openDb>) => handle.db,
    },
  ],
  exports: [DB],
})
export class DbModule implements OnApplicationShutdown {
  constructor(
    @Inject(SQLITE) private readonly handle: ReturnType<typeof openDb>,
  ) {}

  onApplicationShutdown() {
    this.handle.sqlite.close();
  }
}
