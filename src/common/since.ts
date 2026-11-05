import { BadRequestException } from '@nestjs/common';

/**
 * "Today" is defined by the caller (the browser sends its local midnight),
 * falling back to the server's local midnight.
 */
export function parseSince(since?: string): Date {
  if (!since) {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }
  const d = new Date(since);
  if (Number.isNaN(d.getTime()))
    throw new BadRequestException('since must be an ISO date');
  return d;
}
