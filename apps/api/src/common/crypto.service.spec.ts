import { describe, expect, it } from 'vitest';

import { AppConfigService } from '../config/app-config.service';
import { CryptoService } from './crypto.service';

const keyOf = (byte: number): string => Buffer.alloc(32, byte).toString('hex');

const serviceWith = (key: string): CryptoService =>
  new CryptoService({ get: () => key } as unknown as AppConfigService);

describe('CryptoService', () => {
  it('расшифровывает то, что зашифровал', () => {
    const crypto = serviceWith(keyOf(1));
    const secret = 'TgZW!@Eg5q69bAt — пароль с юникодом';
    expect(crypto.decrypt(crypto.encrypt(secret))).toBe(secret);
  });

  it('даёт разный шифротекст на одинаковый вход', () => {
    const crypto = serviceWith(keyOf(2));
    // повторный IV в GCM ломает шифр целиком, поэтому это не косметика
    expect(crypto.encrypt('одно и то же')).not.toBe(crypto.encrypt('одно и то же'));
  });

  it('не расшифровывает чужим ключом', () => {
    const encrypted = serviceWith(keyOf(3)).encrypt('секрет');
    expect(() => serviceWith(keyOf(4)).decrypt(encrypted)).toThrow();
  });

  it('замечает правку шифротекста', () => {
    const crypto = serviceWith(keyOf(5));
    const raw = Buffer.from(crypto.encrypt('секрет'), 'base64');
    raw[raw.length - 1] ^= 0xff;
    expect(() => crypto.decrypt(raw.toString('base64'))).toThrow();
  });

  it('tryDecrypt возвращает null вместо исключения', () => {
    const crypto = serviceWith(keyOf(6));
    expect(crypto.tryDecrypt(null)).toBeNull();
    expect(crypto.tryDecrypt(serviceWith(keyOf(7)).encrypt('секрет'))).toBeNull();
  });

  it('отвергает обрезанное значение', () => {
    const crypto = serviceWith(keyOf(8));
    expect(() => crypto.decrypt(Buffer.alloc(10).toString('base64'))).toThrow(/повреждено/);
  });
});
