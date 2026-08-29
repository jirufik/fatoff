import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

export class DriveSettingsBodyDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  url?: string | null;

  /** Время проверки `ЧЧ:ММ`; вид проверяется в сервисе вместе с остальным. */
  @IsOptional()
  @IsString()
  @MaxLength(5)
  dailyAt?: string | null;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}
