import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';

/**
 * AES-256-GCM encryption for at-rest secrets (OAuth access tokens).
 *
 * Ciphertext format stored in DB: `<ivBase64>:<authTagBase64>:<encryptedBase64>`
 *
 * If your project already has an encryption utility, delete this file and
 * point GithubService/GitlabService at that instead — the interface used
 * elsewhere is just `encrypt(plain: string): string` / `decrypt(cipher: string): string`.
 */
@Injectable()
export class CryptoService {
  private readonly algorithm = 'aes-256-gcm';
  private readonly key: Buffer;

  constructor(private readonly config: ConfigService) {
    const rawKey = this.config.get<string>('ENCRYPTION_KEY');
    if (!rawKey) {
      throw new Error('ENCRYPTION_KEY is not set');
    }
    const keyBuffer = Buffer.from(rawKey, 'base64');
    if (keyBuffer.length !== 32) {
      throw new Error('ENCRYPTION_KEY must decode to 32 bytes (base64 of a 256-bit key)');
    }
    this.key = keyBuffer;
  }

  encrypt(plainText: string): string {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv(this.algorithm, this.key, iv);
    const encrypted = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return `${iv.toString('base64')}:${authTag.toString('base64')}:${encrypted.toString('base64')}`;
  }

  decrypt(cipherText: string): string {
    const [ivB64, tagB64, dataB64] = cipherText.split(':');
    if (!ivB64 || !tagB64 || !dataB64) {
      throw new Error('Malformed ciphertext');
    }
    const iv = Buffer.from(ivB64, 'base64');
    const authTag = Buffer.from(tagB64, 'base64');
    const encrypted = Buffer.from(dataB64, 'base64');
    const decipher = crypto.createDecipheriv(this.algorithm, this.key, iv);
    decipher.setAuthTag(authTag);
    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    return decrypted.toString('utf8');
  }
}
