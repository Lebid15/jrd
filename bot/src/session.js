import makeWASocket, {
  DisconnectReason,
  fetchLatestBaileysVersion,
} from '@whiskeysockets/baileys';
import { useEncryptedAuthState } from './encryptedAuthStore.js';
import { ingestMessage } from './backendClient.js';
import logger from './logger.js';
import path from 'path';
import { config } from './config.js';
import QRCode from 'qrcode';

export class Session {
  constructor(tenantId) {
    this.tenantId = tenantId;
    this.authDir = path.join(config.authDir, String(tenantId));
    this.state = 'idle';       // idle | qr | connecting | connected | closed
    this.qrDataUrl = null;
    this.phoneNumber = null;
    this.sock = null;
    this._onQR = null;         // callback للواجهة
  }

  async start() {
    if (this.state === 'connected' || this.state === 'connecting') return;
    this.state = 'connecting';

    const { state, saveCreds } = await useEncryptedAuthState(this.authDir);
    const { version } = await fetchLatestBaileysVersion();

    this.sock = makeWASocket({
      version,
      auth: state,
      printQRInTerminal: false,
      logger: logger.child({ tenant: this.tenantId }),
    });

    this.sock.ev.on('creds.update', saveCreds);

    this.sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        this.state = 'qr';
        this.qrDataUrl = await QRCode.toDataURL(qr);
        logger.info({ tenant: this.tenantId }, 'QR generated');
      }

      if (connection === 'open') {
        this.state = 'connected';
        this.qrDataUrl = null;
        this.phoneNumber = this.sock.user?.id?.split(':')[0] || null;
        logger.info({ tenant: this.tenantId, phone: this.phoneNumber }, 'Connected');
      }

      if (connection === 'close') {
        const code = lastDisconnect?.error?.output?.statusCode;
        const loggedOut = code === DisconnectReason.loggedOut;
        logger.warn({ tenant: this.tenantId, code, loggedOut }, 'Connection closed');
        this.state = loggedOut ? 'closed' : 'connecting';
        if (!loggedOut) {
          setTimeout(() => this.start(), 5000);
        }
      }
    });

    this.sock.ev.on('messages.upsert', async ({ messages }) => {
      for (const msg of messages) {
        if (!msg.message) continue;
        if (msg.key.fromMe) continue;
        const jid = msg.key.remoteJid || '';
        const isGroup = jid.endsWith('@g.us');

        const text =
          msg.message.conversation ||
          msg.message.extendedTextMessage?.text ||
          msg.message.imageMessage?.caption ||
          msg.message.videoMessage?.caption ||
          '';

        if (!text.trim()) continue;

        let groupName = null;
        if (isGroup) {
          try {
            const meta = await this.sock.groupMetadata(jid);
            groupName = meta.subject;
          } catch {}
        }

        await ingestMessage({
          tenant_id: this.tenantId,
          group_id: jid,
          group_name: groupName,
          sender: msg.key.participant || msg.key.remoteJid,
          sender_name: msg.pushName || null,
          message_id: msg.key.id,
          text,
          is_group: isGroup,
        });
      }
    });
  }

  async logout() {
    if (this.sock) {
      await this.sock.logout().catch(() => {});
      this.sock = null;
    }
    this.state = 'closed';
    this.qrDataUrl = null;
  }

  status() {
    return {
      tenantId: this.tenantId,
      state: this.state,
      qrDataUrl: this.qrDataUrl,
      phoneNumber: this.phoneNumber,
    };
  }
}
