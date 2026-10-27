/**
 * Seed superadmin pertama — CLI interaktif, tidak lewat endpoint publik (FR-1.4).
 * Jalankan: npm run seed:superadmin
 * Non-interaktif (CI): SUPERADMIN_EMAIL, SUPERADMIN_NAMA, SUPERADMIN_PASSWORD via env.
 */
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import * as readline from 'readline/promises';
import { stdin, stdout } from 'process';

async function ask(rl: readline.Interface, prompt: string, fallback?: string): Promise<string> {
  if (fallback !== undefined && fallback !== '') return fallback;
  return (await rl.question(prompt)).trim();
}

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  try {
    const emailEnv = process.env.SUPERADMIN_EMAIL;
    const passEnv = process.env.SUPERADMIN_PASSWORD;

    let rl: readline.Interface | null = null;
    if (!emailEnv || !passEnv) {
      rl = readline.createInterface({ input: stdin, output: stdout });
    }
    const email = (await ask(rl!, 'Email superadmin: ', emailEnv)).toLowerCase();
    const nama = await ask(rl!, 'Nama: ', process.env.SUPERADMIN_NAMA ?? 'Superadmin');
    const password = await ask(rl!, 'Password (min 10): ', passEnv);
    rl?.close();

    if (password.length < 10) {
      throw new Error('Password minimal 10 karakter.');
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new Error('Format email tidak valid.');
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const admin = await prisma.admin.upsert({
      where: { email },
      update: { role: 'superadmin' },
      create: { email, nama, passwordHash, role: 'superadmin' },
    });
    console.log(`Superadmin siap: #${admin.id} ${admin.email}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
