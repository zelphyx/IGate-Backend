import { BOT_COMMANDS, canUseCommand } from './bot-commands';

const ROLE_IDS = {
  panitiaRoleId: 'PANITIA',
  adminRoleId: 'ADMIN',
  superadminRoleId: 'SUPERADMIN',
};

describe('bot-commands (T11)', () => {
  it('semua command terdaftar sesuai FR-8.3', () => {
    const names = BOT_COMMANDS.map((c) => c.name);
    expect(names).toEqual(
      expect.arrayContaining([
        'stats',
        'pendapatan',
        'stok',
        'cek-tiket',
        'cek-voucher',
        'resend-email',
        'verif-manual',
      ]),
    );
    const verif = BOT_COMMANDS.find((c) => c.name === 'verif-manual')!;
    expect(verif.access).toBe('superadmin');
  });

  it('/verif-manual oleh role panitia → ditolak (FR-8.4)', () => {
    const verif = BOT_COMMANDS.find((c) => c.name === 'verif-manual')!;
    expect(canUseCommand(verif, ['PANITIA'], ROLE_IDS)).toBe(false);
  });

  it('/verif-manual oleh superadmin → diizinkan', () => {
    const verif = BOT_COMMANDS.find((c) => c.name === 'verif-manual')!;
    expect(canUseCommand(verif, ['SUPERADMIN'], ROLE_IDS)).toBe(true);
  });

  it('/stats oleh panitia → diizinkan; /resend-email oleh panitia → ditolak', () => {
    const stats = BOT_COMMANDS.find((c) => c.name === 'stats')!;
    const resend = BOT_COMMANDS.find((c) => c.name === 'resend-email')!;
    expect(canUseCommand(stats, ['PANITIA'], ROLE_IDS)).toBe(true);
    expect(canUseCommand(resend, ['PANITIA'], ROLE_IDS)).toBe(false);
    expect(canUseCommand(resend, ['ADMIN'], ROLE_IDS)).toBe(true);
    expect(canUseCommand(resend, ['SUPERADMIN'], ROLE_IDS)).toBe(true);
  });

  it('role id kosong (belum dikonfig) → semua akses ditolak', () => {
    const stats = BOT_COMMANDS.find((c) => c.name === 'stats')!;
    expect(canUseCommand(stats, ['PANITIA'], {})).toBe(false);
  });
});
