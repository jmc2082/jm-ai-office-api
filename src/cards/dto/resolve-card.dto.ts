import { IsOptional, IsString, MaxLength } from 'class-validator';

export class ResolveCardDto {
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;
}
