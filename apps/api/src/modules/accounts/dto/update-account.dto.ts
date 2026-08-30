import { IsBoolean, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class UpdateAccountDto {
  @IsOptional()
  @IsString()
  @MaxLength(64)
  label?: string | null;

  @IsOptional()
  @IsString()
  @MinLength(1)
  password?: string;

  @IsOptional()
  @IsString()
  @MinLength(8)
  accessToken?: string;

  @IsOptional()
  @IsString()
  @MinLength(8)
  refreshToken?: string;

  @IsOptional()
  @IsBoolean()
  syncEnabled?: boolean;

  /** Время ежедневной синхронизации `ЧЧ:ММ`; пустая строка снимает его. */
  @IsOptional()
  @IsString()
  @MaxLength(5)
  syncDailyAt?: string | null;
}
