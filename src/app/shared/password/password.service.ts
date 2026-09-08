import { Injectable } from '@nestjs/common';
import * as crypto from 'crypto';

const SALT_BYTES = 16;
const KEY_LENGTH = 64;

/**
 * Password hashing via Node's built-in scrypt — no external dependency
 * needed (mirrors CryptoService's use of plain `crypto` for AES elsewhere
 * in this codebase). Stored format: `<saltBase64>:<hashBase64>`.
 */
@Injectable()
export class PasswordService {
  async hash(plain: string): Promise<string> {
    const salt = crypto.randomBytes(SALT_BYTES);
    const derivedKey = await this.scrypt(plain, salt, KEY_LENGTH);
    return `${salt.toString('base64')}:${derivedKey.toString('base64')}`;
  }

  async verify(plain: string, stored: string): Promise<boolean> {
    const [saltB64, hashB64] = stored.split(':');
    if (!saltB64 || !hashB64) return false;

    const salt = Buffer.from(saltB64, 'base64');
    const expected = Buffer.from(hashB64, 'base64');
    const derivedKey = await this.scrypt(plain, salt, expected.length);

    return derivedKey.length === expected.length && crypto.timingSafeEqual(derivedKey, expected);
  }

  private scrypt(plain: string, salt: Buffer, keyLength: number): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      crypto.scrypt(plain, salt, keyLength, (err, derivedKey) => {
        if (err) reject(err);
        else resolve(derivedKey);
      });
    });
  }
}
