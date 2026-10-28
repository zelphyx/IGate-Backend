export type CommandAccess = 'panitia' | 'admin' | 'superadmin';

export interface BotCommandDef {
  name: string;
  description: string;
  access: CommandAccess;
  /** Nama opsi Discord (hanya untuk dokumentasi & pendaftaran). */
  options?: { name: string; description: string; required: boolean; type: 'string' }[];
}

export const BOT_COMMANDS: BotCommandDef[] = [
  { name: 'stats', description: 'Ringkasan penjualan, kuota, kehadiran', access: 'panitia' },
  {
    name: 'pendapatan',
    description: 'Pendapatan dari rekap',
    access: 'panitia',
    options: [
      { name: 'periode', description: 'hari-ini atau total', required: false, type: 'string' },
    ],
  },
  { name: 'stok', description: 'Sisa kuota tiket', access: 'panitia' },
  {
    name: 'cek-tiket',
    description: 'Cari tiket berdasarkan NIM / ref / id (PII dimasking)',
    access: 'panitia',
    options: [{ name: 'kunci', description: 'NIM, TKT-x, atau id tiket', required: true, type: 'string' }],
  },
  {
    name: 'cek-voucher',
    description: 'Cek status voucher berdasarkan kode (pemberi dimasking)',
    access: 'panitia',
    options: [{ name: 'kode', description: 'Kode voucher', required: true, type: 'string' }],
  },
  {
    name: 'resend-email',
    description: 'Kirim ulang email tiket (role admin+)',
    access: 'admin',
    options: [{ name: 'id', description: 'Id tiket', required: true, type: 'string' }],
  },
  {
    name: 'verif-manual',
    description: 'Tandai tiket lunas manual (superadmin saja, BR-11)',
    access: 'superadmin',
    options: [{ name: 'merchant-ref', description: 'TKT-{id}', required: true, type: 'string' }],
  },
];

/**
 * Cek hak akses member Discord terhadap command (FR-8.4): kepercayaan dari mapping
 * role-id env, bukan dari klien Discord. superadmin → admin → panitia (berjenjang).
 */
export function canUseCommand(
  command: BotCommandDef,
  memberRoleIds: string[],
  roleIds: { panitiaRoleId?: string; adminRoleId?: string; superadminRoleId?: string },
): boolean {
  const has = (id?: string) => Boolean(id) && memberRoleIds.includes(id as string);
  const isSuperadmin = has(roleIds.superadminRoleId);
  const isAdmin = isSuperadmin || has(roleIds.adminRoleId);
  switch (command.access) {
    case 'panitia':
      return isAdmin || has(roleIds.panitiaRoleId);
    case 'admin':
      return isAdmin;
    case 'superadmin':
      return isSuperadmin;
    default:
      return false;
  }
}
