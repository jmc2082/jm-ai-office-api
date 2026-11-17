import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';

export class ConnectMailboxDto {
  /** Shown in cards, e.g. "personal" or "work". */
  @IsOptional()
  @IsString()
  @MaxLength(40)
  @Matches(/^[\w .-]+$/)
  label?: string;
}
