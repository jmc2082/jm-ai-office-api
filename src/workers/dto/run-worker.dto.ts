import { IsObject, IsOptional } from 'class-validator';

export class RunWorkerDto {
  @IsOptional()
  @IsObject()
  input?: Record<string, unknown>;
}
