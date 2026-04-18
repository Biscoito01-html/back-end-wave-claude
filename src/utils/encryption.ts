import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from 'crypto';

const ALGORITHM = 'aes-256-gcm';

function getKey(): Buffer {
  const secret = process.env.ENCRYPTION_SECRET;
  if (!secret || secret.length !== 32) {
    // Defesa em profundidade: assertEnvironmentReady() em main.ts ja valida
    // isso no boot. Se chegamos aqui com secret invalido, e um bug grave.
    throw new Error(
      'ENCRYPTION_SECRET ausente ou invalido (deve ter exatamente 32 caracteres).',
    );
  }
  return Buffer.from(secret, 'utf-8');
}

export function encryptValue(plainText: string): string {
  const key = getKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plainText, 'utf-8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, encrypted]).toString('base64');
}

export function decryptValue(encoded: string): string {
  const key = getKey();
  const buf = Buffer.from(encoded, 'base64');
  const iv = buf.subarray(0, 12);
  const authTag = buf.subarray(12, 28);
  const encrypted = buf.subarray(28);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  return decipher.update(encrypted).toString('utf-8') + decipher.final('utf-8');
}

export function keyPreview(apiKey: string): string {
  if (apiKey.length <= 8) return '****';
  return `${apiKey.slice(0, 8)}...${apiKey.slice(-4)}`;
}
