import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC = 'isPublic';
/** Skip the auth guard (health checks and OAuth callbacks only). */
export const Public = () => SetMetadata(IS_PUBLIC, true);
