import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { config } from './config.js';

const MAGIC = Buffer.from('JRD1');
const KEY_LEN = 32;

function deriveKey(filename) {
  if (!config.encryptionKey) return null;
  const master = Buffer.from(config.encryptionKey, 'base64');
  return crypto.hkdfSync('sha256', master, filename, '', KEY_LEN);
}

function encrypt(key, plaintext) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([MAGIC, iv, ct, tag]);
}

function decrypt(key, buf) {
  const iv = buf.slice(4, 16);
  const tag = buf.slice(buf.length - 16);
  const ct = buf.slice(16, buf.length - 16);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]);
}

export async function useEncryptedAuthState(folder) {
  fs.mkdirSync(folder, { recursive: true });

  const { initAuthCreds, BufferJSON } = await import('@whiskeysockets/baileys');

  const readFile = (filename) => {
    const fp = path.join(folder, filename);
    if (!fs.existsSync(fp)) return null;
    const buf = fs.readFileSync(fp);
    const key = deriveKey(filename);
    let plain;
    if (key && buf.slice(0, 4).equals(MAGIC)) {
      plain = decrypt(key, buf).toString();
    } else {
      plain = buf.toString();
    }
    return JSON.parse(plain, BufferJSON.reviver);
  };

  const writeFile = (filename, data) => {
    const fp = path.join(folder, filename);
    const plain = Buffer.from(JSON.stringify(data, BufferJSON.replacer));
    const key = deriveKey(filename);
    fs.writeFileSync(fp, key ? encrypt(key, plain) : plain);
  };

  // اسم ملف آمن (يحوي أحياناً ':' في معرّفات Baileys)
  const safeName = (name) => name.replace(/\//g, '__').replace(/:/g, '-');

  let creds = readFile('creds.json') || initAuthCreds();

  return {
    state: {
      creds,
      keys: {
        get: async (type, ids) => {
          const data = {};
          for (const id of ids) {
            const val = readFile(safeName(`${type}-${id}.json`));
            if (val) {
              // app-state-sync-key يحتاج معالجة خاصة
              if (type === 'app-state-sync-key') {
                const { proto } = await import('@whiskeysockets/baileys');
                data[id] = proto.Message.AppStateSyncKeyData.fromObject(val);
              } else {
                data[id] = val;
              }
            }
          }
          return data;
        },
        set: (data) => {
          for (const [type, ids] of Object.entries(data)) {
            for (const [id, val] of Object.entries(ids || {})) {
              const fname = safeName(`${type}-${id}.json`);
              if (val) writeFile(fname, val);
              else {
                const fp = path.join(folder, fname);
                if (fs.existsSync(fp)) fs.unlinkSync(fp);
              }
            }
          }
        },
      },
    },
    saveCreds: () => writeFile('creds.json', creds),
  };
}
