import { IsBoolean, IsIn, IsOptional } from 'class-validator';
import { WORKER_STATUSES, type WorkerStatus } from '../../db/schema.js';

export class UpdateWorkerDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsIn(WORKER_STATUSES)
  status?: WorkerStatus;
}
