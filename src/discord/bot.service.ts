import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import {
  Client,
  Events,
  GatewayIntentBits,
  REST,
  Routes,
  ChatInputCommandInteraction,
  Collection,
} from 'discord.js';
import { PrismaService } from '../prisma/prisma.module';
import {
  MERCHANT_REF_PREFIX,
  REKAP_STATUS,
  TICKET_PAYMENT_STATUS,
  TICKET_STATUS,
  VOUCHER_STATUS,
} from '../common/constants';
import { maskEmail, maskNim, maskPhone } from '../common/utils/mask';
import { startOfTodayJakarta } from '../stats/stats.service';
import { DiscordService } from './discord.service';
import { BOT_COMMANDS, canUseCommand } from './bot-commands';
import { PaymentsService } from '../payments/payments.service';
import { FulfillmentService } from '../fulfillment/fulfillment.service';
import { VouchersService } from '../vouchers/vouchers.service';

/**
 * FR-8: bot Discord — slash commands berjenjang, alert stok (via DiscordService),
 * digest harian 08.00 WIB. Bot mati/token kosong → seluruh alur tetap jalan (FR-8.6).
 */
@Injectable()
export class BotService implements OnModuleDestroy {
  private readonly logger = new Logger(BotService.name);
  private client?: Client;
  private readonly enabled: boolean;
  private readonly guildId?: string;
  private readonly roleIds: { panitiaRoleId?: string; adminRoleId?: string; superadminRoleId?: string };

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly discord: DiscordService,
    private readonly payments: PaymentsService,
    private readonly fulfillment: FulfillmentService,
    private readonly vouchers: VouchersService,
  ) {
    this.enabled = Boolean(config.get<string>('discord.botToken') && config.get<string>('discord.guildId'));
    this.guildId = config.get<string>('discord.guildId') || undefined;
    this.roleIds = {
      panitiaRoleId: config.get<string>('discord.panitiaRoleId') || undefined,
      adminRoleId: config.get<string>('discord.adminRoleId') || undefined,
      superadminRoleId: config.get<string>('discord.superadminRoleId') || undefined,
    };
  }

  async onModuleInit(): Promise<void> {
    if (!this.enabled) {
      this.logger.log('Bot Discord nonaktif (DISCORD_BOT_TOKEN/DISCORD_GUILD_ID kosong).');
      return;
    }
    try {
      await this.start();
    } catch (err) {
      this.logger.error(`Bot gagal start (diabaikan, alur utama tetap jalan): ${(err as Error).message}`);
    }
  }

  private async start(): Promise<void> {
    const token = this.config.get<string>('discord.botToken')!;
    const client = new Client({ intents: [GatewayIntentBits.Guilds] });
    this.client = client;

    client.once(Events.ClientReady, async (c) => {
      this.logger.log(`Bot Discord masuk sebagai ${c.user.tag}`);
      try {
        const rest = new REST().setToken(token);
        await rest.put(
          Routes.applicationGuildCommands(c.user.id, this.guildId!),
          {
            body: BOT_COMMANDS.map((cmd) => ({
              name: cmd.name,
              description: cmd.description,
              options: cmd.options ?? [],
            })),
          },
        );
        this.logger.log(`Slash commands terdaftar di guild ${this.guildId}`);
      } catch (err) {
        this.logger.error(`Gagal daftar slash commands: ${(err as Error).message}`);
      }
    });

    client.on(Events.InteractionCreate, async (interaction) => {
      if (!interaction.isChatInputCommand()) return;
      try {
        await this.handleInteraction(interaction);
      } catch (err) {
        this.logger.warn(`Interaction gagal: ${(err as Error).message}`);
        await this.safeReply(interaction, 'Terjadi kesalahan menjalankan perintah.');
      }
    });

    await client.login(token);
  }

  /** Router command + cek role (kepercayaan tidak dari klien, FR-8.4). */
  async handleInteraction(interaction: ChatInputCommandInteraction): Promise<void> {
    if (interaction.guildId !== this.guildId) {
      await this.safeReply(interaction, 'Perintah hanya bisa dipakai di server IGATE.');
      return;
    }
    const def = BOT_COMMANDS.find((c) => c.name === interaction.commandName);
    if (!def) {
      await this.safeReply(interaction, 'Perintah tidak dikenal.');
      return;
    }
    const memberRoleIds = [...(interaction.member?.roles as Collection<string, unknown> | undefined)?.keys() ?? []];
    if (!canUseCommand(def, memberRoleIds, this.roleIds)) {
      await this.safeReply(interaction, 'Kamu tidak punya role untuk perintah ini.');
      return;
    }

    switch (def.name) {
      case 'stats':
        await this.safeReply(interaction, await this.renderStats());
        break;
      case 'pendapatan': {
        const periode = interaction.options.getString('periode') ?? 'hari-ini';
        await this.safeReply(interaction, await this.renderPendapatan(periode));
        break;
      }
      case 'stok':
        await this.safeReply(interaction, await this.renderStok());
        break;
      case 'cek-tiket':
        await this.safeReply(interaction, await this.renderCekTiket(interaction.options.getString('kunci') ?? ''));
        break;
      case 'cek-voucher':
        await this.safeReply(interaction, await this.renderCekVoucher(interaction.options.getString('kode') ?? ''));
        break;
      case 'resend-email': {
        const id = Number(interaction.options.getString('id'));
        if (!Number.isInteger(id)) {
          await this.safeReply(interaction, 'Id tiket tidak valid.');
          break;
        }
        await this.fulfillment.resend(id);
        await this.safeReply(interaction, `Email TKT-${id} diantrekan ulang.`);
        break;
      }
      case 'verif-manual': {
        const ref = interaction.options.getString('merchant-ref') ?? '';
        const match = ref.match(new RegExp(`^${MERCHANT_REF_PREFIX.TIKET}(\\d+)$`));
        if (!match) {
          await this.safeReply(interaction, 'Format merchant-ref: TKT-{id}.');
          break;
        }
        const actor = `discord:${interaction.user.username}`;
        const result = await this.payments.verifyManualOrder(Number(match[1]), { adminId: null, email: actor });
        await this.safeReply(
          interaction,
          result.processed
            ? `TKT-${match[1]} ditandai lunas (audit tercatat).`
            : `Tidak diproses: ${result.reason ?? '?'}`,
        );
        break;
      }
      default:
        await this.safeReply(interaction, 'Perintah belum diimplementasi.');
    }
  }

  private async safeReply(interaction: ChatInputCommandInteraction, text: string): Promise<void> {
    try {
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply(text.slice(0, 1900));
      } else {
        await interaction.reply({ content: text.slice(0, 1900), ephemeral: true });
      }
    } catch (err) {
      this.logger.warn(`Balasan Discord gagal (diabaikan): ${(err as Error).message}`);
    }
  }

  private async renderStats(): Promise<string> {
    const [terjual, unpaid, checkedIn, expired] = await Promise.all([
      this.prisma.tiket.count({ where: { statusPembayaran: TICKET_PAYMENT_STATUS.PAID } }),
      this.prisma.tiket.count({ where: { statusPembayaran: TICKET_PAYMENT_STATUS.UNPAID } }),
      this.prisma.tiket.count({ where: { statusTiket: TICKET_STATUS.CHECKED_IN } }),
      this.prisma.tiket.count({ where: { statusPembayaran: TICKET_PAYMENT_STATUS.EXPIRED } }),
    ]);
    const used = await this.prisma.tiket.count({
      where: { statusPembayaran: { in: [TICKET_PAYMENT_STATUS.UNPAID, TICKET_PAYMENT_STATUS.PAID] } },
    });
    const max = this.config.get<number>('maxTickets') ?? 0;
    return [
      '**STATS TIKET IGATE**',
      `• Terjual (lunas): ${terjual}`,
      `• UNPAID: ${unpaid}`,
      `• Check-in: ${checkedIn}`,
      `• EXPIRED: ${expired}`,
      `• Sisa kuota: ${Math.max(max - used, 0)} / ${max}`,
    ].join('\n');
  }

  private async renderPendapatan(periode: string): Promise<string> {
    const where =
      periode === 'hari-ini'
        ? { status: REKAP_STATUS.SUCCESS, createdAt: { gte: startOfTodayJakarta() } }
        : { status: REKAP_STATUS.SUCCESS };
    const agg = await this.prisma.rekap.aggregate({ _sum: { nominal: true }, where });
    const label = periode === 'hari-ini' ? 'hari ini (WIB)' : 'total';
    return `**PENDAPATAN ${label.toUpperCase()}**\n• Rp ${agg._sum.nominal?.toString() ?? '0'}`;
  }

  private async renderStok(): Promise<string> {
    const used = await this.prisma.tiket.count({
      where: { statusPembayaran: { in: [TICKET_PAYMENT_STATUS.UNPAID, TICKET_PAYMENT_STATUS.PAID] } },
    });
    const max = this.config.get<number>('maxTickets') ?? 0;
    return `**STOK**\n• Terpakai: ${used}\n• Sisa: ${Math.max(max - used, 0)} / ${max}`;
  }

  /** PII dimasking (FR-8.3). */
  private async renderCekTiket(kunci: string): Promise<string> {
    let tiket = null;
    const refMatch = kunci.match(new RegExp(`^${MERCHANT_REF_PREFIX.TIKET}(\\d+)$`));
    if (refMatch) {
      tiket = await this.prisma.tiket.findUnique({ where: { id: Number(refMatch[1]) } });
    } else if (/^\d+$/.test(kunci)) {
      const byId = await this.prisma.tiket.findUnique({ where: { id: Number(kunci) } });
      const byNim = await this.prisma.tiket.findFirst({ where: { nim: kunci } });
      tiket = byId ?? byNim;
    } else {
      tiket = await this.prisma.tiket.findFirst({ where: { nim: kunci } });
    }
    if (!tiket) return `Tiket untuk "${kunci}" tidak ditemukan.`;
    return [
      `**TIKET-${tiket.id}**`,
      `• Nama: ${tiket.nama}`,
      `• NIM: ${maskNim(tiket.nim)}`,
      `• Email: ${maskEmail(tiket.email)}`,
      `• HP: ${maskPhone(tiket.nomorHp)}`,
      `• Bayar: ${tiket.statusPembayaran} (total Rp ${tiket.totalBayar.toString()})`,
      `• Tiket: ${tiket.statusTiket}`,
      tiket.checkedInAt ? `• Check-in: ${tiket.checkedInAt.toISOString()}` : '',
    ]
      .filter(Boolean)
      .join('\n');
  }

  private async renderCekVoucher(kode: string): Promise<string> {
    const voucher = await this.prisma.voucher.findUnique({
      where: { kodeVoucher: kode.trim().toUpperCase() },
    });
    if (!voucher) return `Voucher "${kode}" tidak ditemukan.`;
    return [
      `**VOUCHER ${voucher.kodeVoucher}**`,
      `• Status: ${voucher.status}`,
      `• Nilai: Rp ${voucher.nilaiVoucher.toString()}`,
      `• Pemberi: ${voucher.namaPemberi}`,
      `• NIM: ${maskNim(voucher.nim)}`,
      `• HP: ${maskPhone(voucher.nomorHp)}`,
      `• Berlaku s/d: ${voucher.expiredAt.toISOString()}`,
    ].join('\n');
  }

  /** FR-8.5: digest harian 08.00 WIB → channel log. */
  @Cron('0 8 * * *', { timeZone: 'Asia/Jakarta' })
  async digestHarian(): Promise<void> {
    try {
      const sejak = new Date(Date.now() - 24 * 3600_000);
      const [orderBaru, lunas, pendapatan, checkin] = await Promise.all([
        this.prisma.tiket.count({ where: { createdAt: { gte: sejak } } }),
        this.prisma.tiket.count({ where: { statusPembayaran: TICKET_PAYMENT_STATUS.PAID, paidAt: { gte: sejak } } }),
        this.prisma.rekap.aggregate({
          _sum: { nominal: true },
          where: { status: REKAP_STATUS.SUCCESS, createdAt: { gte: sejak } },
        }),
        this.prisma.tiket.count({ where: { statusTiket: TICKET_STATUS.CHECKED_IN, checkedInAt: { gte: sejak } } }),
      ]);
      this.discord.logInfo('DIGEST_HARIAN', {
        orderBaru,
        lunas,
        pendapatan: `Rp ${pendapatan._sum.nominal?.toString() ?? '0'}`,
        checkin,
      });
    } catch (err) {
      this.logger.warn(`Digest gagal (diabaikan): ${(err as Error).message}`);
    }
  }

  onModuleDestroy(): void {
    void this.client?.destroy();
  }
}
