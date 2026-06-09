import makeWASocket, {
  DisconnectReason,
  fetchLatestBaileysVersion,
  Browsers,
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
    this._reconnectAttempts = 0; // exponential backoff counter
    this._reconnectTimer = null; // مرجع timer لمنع الازدواج
  }

  async start({ force = false } = {}) {
    if (this.state === 'connected') return;
    if (this.state === 'connecting' && !force) return;

    // Tear down any existing socket before starting fresh
    if (this.sock) {
      try { this.sock.ev.removeAllListeners(); } catch {}
      try { this.sock.end?.(); } catch {}
      this.sock = null;
    }
    this.qrDataUrl = null;
    this.state = 'connecting';

    const { state, saveCreds } = await useEncryptedAuthState(this.authDir);
    const { version } = await fetchLatestBaileysVersion();

    this.sock = makeWASocket({
      version,
      auth: state,
      printQRInTerminal: false,
      browser: Browsers.macOS('Desktop'),
      syncFullHistory: false,
      markOnlineOnConnect: false,
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
        this._reconnectAttempts = 0; // أعد العدّاد عند نجاح الاتصال
        logger.info({ tenant: this.tenantId, phone: this.phoneNumber }, 'Connected');

        // عبّئ كاش أسماء المجموعات مسبقاً (يتفادى timeouts عند ورود الرسائل)
        setTimeout(async () => {
          try {
            const groups = await this.sock.groupFetchAllParticipating();
            if (!this._groupCache) this._groupCache = new Map();
            for (const g of Object.values(groups)) {
              this._groupCache.set(g.id, g.subject);
            }
            logger.info({ tenant: this.tenantId, count: this._groupCache.size }, 'group cache primed');
          } catch (e) {
            logger.warn({ tenant: this.tenantId, err: e.message }, 'group cache prime failed');
          }
        }, 3000);
      }

      if (connection === 'close') {
        const code = lastDisconnect?.error?.output?.statusCode;
        const loggedOut = code === DisconnectReason.loggedOut;
        const restartRequired = code === DisconnectReason.restartRequired; // 515 — يحدث بعد مسح QR
        logger.warn({ tenant: this.tenantId, code, loggedOut, restartRequired }, 'Connection closed');

        if (loggedOut) {
          this.state = 'closed';
          return;
        }

        // restartRequired = اقتران ناجح، نحتاج إعادة فتح socket فوراً بنفس creds
        // باقي الأخطاء = انقطاع شبكي → exponential backoff لمنع spam على الخادم
        this._reconnectAttempts = restartRequired ? 0 : Math.min(this._reconnectAttempts + 1, 7);
        const delay = restartRequired
          ? 0
          : Math.min(60000, 2000 * 2 ** (this._reconnectAttempts - 1)); // 2s,4s,8s,16s,32s,60s,60s
        this.state = 'connecting';
        if (this._reconnectTimer) clearTimeout(this._reconnectTimer);
        this._reconnectTimer = setTimeout(() => {
          this._reconnectTimer = null;
          this.start({ force: true }).catch(err => {
            logger.error({ tenant: this.tenantId, err: err.message }, 'Reconnect failed — health-check سيحاول لاحقاً');
            // عند فشل start نفسها، أعد الحالة إلى idle ليتمكّن health-check من إعادة المحاولة
            this.state = 'idle';
          });
        }, delay);
      }
    });

    this.sock.ev.on('messages.upsert', async ({ messages, type }) => {
      for (const msg of messages) {
        try {
          if (!msg.message) continue;
          if (msg.key.fromMe) continue;
          const jid = msg.key.remoteJid || '';
          const isGroup = jid.endsWith('@g.us');

          // دعم ephemeral / viewOnce / reactions الخ
          const inner =
            msg.message.ephemeralMessage?.message ||
            msg.message.viewOnceMessage?.message ||
            msg.message.viewOnceMessageV2?.message ||
            msg.message;

          const text =
            inner.conversation ||
            inner.extendedTextMessage?.text ||
            inner.imageMessage?.caption ||
            inner.videoMessage?.caption ||
            inner.documentMessage?.caption ||
            inner.documentWithCaptionMessage?.message?.documentMessage?.caption ||
            '';

          if (!text.trim()) continue;

          let groupName = null;
          if (isGroup) {
            // 1) جرّب من الكاش (سريع، لا timeout)
            try {
              const cached = this._groupCache?.get(jid);
              if (cached) groupName = cached;
            } catch {}
            // 2) لو لا يوجد كاش، اطلب metadata مع timeout قصير
            if (!groupName) {
              try {
                const meta = await Promise.race([
                  this.sock.groupMetadata(jid),
                  new Promise((_, rej) => setTimeout(() => rej(new Error('meta_timeout')), 5000)),
                ]);
                groupName = meta?.subject || null;
                if (groupName) {
                  if (!this._groupCache) this._groupCache = new Map();
                  this._groupCache.set(jid, groupName);
                }
              } catch (e) {
                logger.warn({ tenant: this.tenantId, jid, err: e.message }, 'groupMetadata failed');
              }
            }
          }

          logger.info({
            tenant: this.tenantId,
            jid,
            isGroup,
            groupName,
            sender: msg.pushName,
            text: text.slice(0, 60),
            type,
          }, '[wa→ingest]');

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
        } catch (err) {
          logger.error({ tenant: this.tenantId, err: err.message }, 'message handler failed');
        }
      }
    });
  }

  async logout() {
    if (this.sock) {
      await this.sock.logout().catch(() => {});
      try { this.sock.ev.removeAllListeners(); } catch {}
      this.sock = null;
    }
    this.state = 'closed';
    this.qrDataUrl = null;
  }

  async purgeAuth() {
    const fs = await import('fs');
    if (this.sock) {
      try { this.sock.ev.removeAllListeners(); } catch {}
      try { this.sock.end?.(); } catch {}
      this.sock = null;
    }
    try {
      fs.rmSync(this.authDir, { recursive: true, force: true });
    } catch {}
    this.state = 'idle';
    this.qrDataUrl = null;
    this.phoneNumber = null;
  }

  async listGroups() {
    if (!this.sock || this.state !== 'connected') return [];
    try {
      const groups = await this.sock.groupFetchAllParticipating();
      return Object.values(groups).map(g => ({
        id: g.id,
        subject: g.subject,
        size: g.participants?.length || 0,
      }));
    } catch (err) {
      logger.error({ tenant: this.tenantId, err }, 'listGroups failed');
      return [];
    }
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
