import { Injectable } from '@nestjs/common';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

import { AppConfigService } from '../config/app-config.service';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const TAG_BYTES = 16;

/**
 * Шифрование учётных данных YAZIO (D-004).
 *
 * AES-256-GCM: он даёт не только скрытие, но и проверку целостности — правка
 * шифротекста в базе не пройдёт незамеченной, расшифровка упадёт. Ключ берётся
 * из окружения, то есть живёт вне базы: дамп базы без `.env` бесполезен.
 *
 * Формат хранения: base64 от `iv | tag | ciphertext`. Одна строка на поле,
 * никаких отдельных колонок под вектор инициализации.
 */
@Injectable()
export class CryptoService {
  private readonly key: Buffer;

  constructor(config: AppConfigService) {
    this.key = Buffer.from(config.get('SECRETS_KEY'), 'hex');
  }

  encrypt(plain: string): string {
    // новый вектор на каждое шифрование: иначе два одинаковых пароля дадут
    // одинаковый шифротекст, а GCM с повторным IV ломается полностью
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64');
  }

  decrypt(payload: string): string {
    const raw = Buffer.from(payload, 'base64');
    if (raw.length <= IV_BYTES + TAG_BYTES) {
      throw new Error('Зашифрованное значение повреждено: слишком короткое');
    }
    const iv = raw.subarray(0, IV_BYTES);
    const tag = raw.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
    const ciphertext = raw.subarray(IV_BYTES + TAG_BYTES);

    const decipher = createDecipheriv(ALGORITHM, this.key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  }

  /** Расшифровать, не роняя вызывающего: ключ мог смениться. */
  tryDecrypt(payload: string | null): string | null {
    if (!payload) return null;
    try {
      return this.decrypt(payload);
    } catch {
      return null;
    }
  }
}
