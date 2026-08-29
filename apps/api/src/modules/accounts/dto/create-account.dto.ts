import { IsEmail, IsOptional, IsString, MaxLength, MinLength, ValidateIf } from 'class-validator';

/**
 * Два способа добавить аккаунт: пара почта/пароль и готовый токен.
 * Токен нужен там, где пароля не существует — вход через Apple ID (D-017).
 */
export class CreateAccountDto {
  /** При входе по токену почта не нужна: её сообщит сам YAZIO. */
  @ValidateIf((dto: CreateAccountDto) => !dto.accessToken)
  @IsEmail({}, { message: 'Некорректный адрес почты' })
  email!: string;

  @ValidateIf((dto: CreateAccountDto) => !dto.accessToken)
  @IsString()
  @MinLength(1, { message: 'Не передан ни пароль, ни токен доступа' })
  password?: string;

  @IsOptional()
  @IsString()
  @MinLength(8, { message: 'Токен доступа выглядит слишком коротким' })
  accessToken?: string;

  @IsOptional()
  @IsString()
  @MinLength(8, { message: 'Токен обновления выглядит слишком коротким' })
  refreshToken?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  label?: string;
}
