import { Injectable, Logger, OnModuleDestroy, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.module';
import { TICKET_PAYMENT_STATUS } from '../common/constants';
import { maskEmail, maskNim, maskPhone } from '../common/utils/mask';

type WebhookTarget = 'log' | 'error';

export interface DiscordEventData {
  email?: string;
  nim?: string;
  nomorHp?: string;
  [key: string]: unknown;
}

/**
 * FR-8: integrasi Discord non-blocking — kegagalan Discord tidak pernah menggagalkan
 * alur utama. Kirim berurutan (rate-limit aware); webhook kosong → log aplikasi saja.
 * PII dimasking otomatis (§12.6). logWarn/logCritical → channel error; critical ping role.
 */
@Injectable()
export class DiscordService implements OnModuleDestroy {  private readonly logger = new Logger(DiscordService.name);
  private readonly logWebhook?: string;
  private readonly errorWebhook?: string;
  private readonly alertRoleId?: string;
  private readonly stockThresholdPct: number;
  private readonly maxTickets?: number;
  private lastStockAlertAt?: Date;
  private queue: Promise<void> = Promise.resolve();

  constructor(
    config: ConfigService,
    @Optional() private readonly prisma?: PrismaService,
  ) {
    this.logWebhook = config.get<string>('discord.logWebhookUrl') || undefined;
    this.errorWebhook = config.get<string>('discord.errorWebhookUrl') || undefined;
    this.alertRoleId = config.get<string>('discord.alertRoleId') || undefined;
    this.stockThresholdPct = config.get<number>('discord.stockAlertThreshold') ?? 10;
    this.maxTickets = config.get<number>('maxTickets');
  }

  logInfo(event: string, data: DiscordEventData = {}): void {
    this.enqueue('log', this.format(`ℹ️ ${event}`, data));
  }

  logWarn(message: string): void {
    this.logger.warn(message);
    this.enqueue('error', `⚠️ ${message}`);
  }

  logCritical(message: string): void {
    this.logger.error(message);
    const ping = this.alertRoleId ? `<@&${this.alertRoleId}> ` : '';
    this.enqueue('error', `🚨 ${ping}${message}`);
  }

  /**
   * Alert stok hampir habis (FR-8.2): dipanggil setelah order dibuat & oleh sweep.
   * Sisa kuota ≤ STOCK_ALERT_THRESHOLD% dari MAX_TICKETS → logCritical (ping role alert),
   * debounce maksimal 1x/hari. Kegagalan tidak pernah mengganggu alur utama.
   */
  async notifyStock(): Promise<void> {
    if (!this.prisma || !this.maxTickets) return;
    try {
      const used = await this.prisma.tiket.count({
        where: { statusPembayaran: { in: [TICKET_PAYMENT_STATUS.UNPAID, TICKET_PAYMENT_STATUS.PAID] } },
      });
      const sisa = Math.max(this.maxTickets - used, 0);
      const ambang = Math.max(1, Math.round((this.maxTickets * this.stockThresholdPct) / 100));
      if (sisa > ambang) return;
      if (this.lastStockAlertAt && Date.now() - this.lastStockAlertAt.getTime() < 24 * 3600_000) {
        return; // debounce: maksimal 1x per hari (FR-8.2)
      }
      this.lastStockAlertAt = new Date();
      if (sisa > 0) {
        this.logCritical(`STOK MENIPIS: sisa kuota tiket tinggal ${sisa} (ambang ${ambang}).`);
      } else {
        this.logCritical('STOK HABIS: kuota tiket 0 — order baru akan ditolak (BR-04).');
      }
    } catch (err) {
      this.logger.warn(`notifyStock gagal (diabaikan): ${(err as Error).message}`);
    }
  }

  /** PII otomatis dimask berdasarkan nama field. */
  private format(title: string, data: DiscordEventData): string {
    const lines = Object.entries(data).map(([key, value]) => {
      let v = value;
      if (key === 'email' && typeof value === 'string') v = maskEmail(value);
      if (key === 'nim' && typeof value === 'string') v = maskNim(value);
      if (key === 'nomorHp' && typeof value === 'string') v = maskPhone(value);
      return `• ${key}: ${String(v)}`;
    });
    return lines.length > 0 ? `**${title}**\n${lines.join('\n')}` : `**${title}**`;
  }

  private enqueue(target: WebhookTarget, content: string): void {
    this.queue = this.queue
      .then(() => this.send(target, content))
      .catch((err) => this.logger.warn(`Discord send gagal (diabaikan): ${err.message}`));
  }

  private async send(target: WebhookTarget, content: string): Promise<void> {
    const url = target === 'log' ? this.logWebhook : this.errorWebhook;
    if (!url) return; // belum dikonfigurasi → hanya log aplikasi
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: content.slice(0, 1900) }),
    });
  }

  onModuleDestroy(): void {
    // antrean dibiarkan selesai natural pada graceful shutdown (PRD NFR-06)
  }
}
