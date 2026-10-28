import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { ThrottlerStorage, ThrottlerStorageService } from '@nestjs/throttler';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.module';

/**
 * E2E penuh (PLAN §T12, PRD §15) — memakai infra nyata dari docker-compose.dev.yml
 * (MySQL + Redis) dan Tripay stub (TRIPAY_MODE=test). SMTP tidak diset → transport log.
 *
 * Jalankan: npm run test:e2e
 */

const callback = (
  app: INestApplication,
  body: Record<string, unknown>,
  signature = 'valid-x',
) =>
  request(app.getHttpServer())
    .post('/api/v1/payments/callback')
    .set('X-Callback-Signature', signature)
    .send(body);

const stubSignature = (body: string) => `valid-${Buffer.byteLength(body)}`;

describe('Ticketing IGATE — alur penuh (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let superadminToken: string;
  let scannerToken: string;

  const order = (nim: string, kodeVoucher?: string) =>
    request(app.getHttpServer())
      .post('/api/v1/orders')
      .send({
        nama: `Tester ${nim}`,
        nim,
        nomorHp: '081234567890',
        email: `tester${nim}@mail.id`,
        ...(kodeVoucher ? { kodeVoucher } : {}),
      });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication({ rawBody: true });
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);

    // login superadmin seed
    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: process.env.SUPERADMIN_EMAIL ?? 'ketua@igate.id', password: process.env.SUPERADMIN_PASSWORD ?? 'superadmin123' });
    superadminToken = login.body.accessToken;

    // buat scanner untuk uji role
    const mk = await request(app.getHttpServer())
      .post('/api/v1/admin')
      .set('Authorization', `Bearer ${superadminToken}`)
      .send({ email: `scanner-e2e-${Date.now()}@igate.id`, nama: 'Scanner E2E', password: 'scanner12345', role: 'scanner' });
    const scanLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: mk.body.email, password: 'scanner12345' });
    scannerToken = scanLogin.body.accessToken;
  });

  beforeEach(async () => {
    // rate limit 5/menit/IP (PRD §12.5) tidak relevan antar-case e2e — reset storage-nya
    const storage = app.get<ThrottlerStorageService>(ThrottlerStorage as symbol);
    storage.storage.clear();
    // hitExpirations (private) ikut direset — pruneExpiredHits menghitung ulang totalHits dari sini
    (storage as unknown as { hitExpirations: Map<string, unknown> }).hitExpirations.clear();
  });

  afterAll(async () => {
    await app.close();
  });

  it('1. NIM tidak diawali 2406012 → 422 (BR-02)', async () => {
    const res = await order('2306012123');
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('NIM_TIDAK_VALID');
  });

  it('2. alur bahagia: order → callback PAID → rekap + tiket PAID', async () => {
    const nim = `2406012${String(Math.floor(Math.random() * 9000) + 1000)}`;
    const res = await order(nim);
    expect(res.status).toBe(201);
    expect(res.body.statusPembayaran).toBe('UNPAID');

    const body = JSON.stringify({
      reference: 'E2E-TRX1',
      merchant_ref: res.body.merchantRef,
      status: 'PAID',
      payment_method: 'QRIS',
    });
    const cb = await callback(app, JSON.parse(body), stubSignature(body));
    expect(cb.status).toBe(200);

    const id = Number(res.body.merchantRef.split('-')[1]);
    const tiket = await prisma.tiket.findUnique({ where: { id } });
    expect(tiket?.statusPembayaran).toBe('PAID');
    const rekap = await prisma.rekap.findFirst({
      where: { tiketId: id, status: 'SUCCESS', metodePembayaran: 'QRIS' },
    });
    expect(rekap).toBeTruthy();
  });

  it('3. signature salah → 401 tanpa memproses (FR-3.2)', async () => {
    const res = await callback(app, { reference: 'X', merchant_ref: 'TKT-99999', status: 'PAID' }, 'signature-ngawur');
    expect(res.status).toBe(401);
    const tiket = await prisma.tiket.findUnique({ where: { id: 99999 } });
    expect(tiket).toBeNull();
  });

  it('4. callback dobel → idempotent (FR-3.3)', async () => {
    const nim = `2406012${String(Math.floor(Math.random() * 9000) + 1000)}`;
    const created = await order(nim);
    const id = Number(created.body.merchantRef.split('-')[1]);
    const body = JSON.stringify({ reference: 'E2E-TRX2', merchant_ref: `TKT-${id}`, status: 'PAID', payment_method: 'QRIS' });
    await callback(app, JSON.parse(body), stubSignature(body));
    await callback(app, JSON.parse(body), stubSignature(body)); // dobel
    const rekapCount = await prisma.rekap.count({ where: { tiketId: id, status: 'SUCCESS' } });
    expect(rekapCount).toBe(1);
  });

  it('5. voucher full-cover → langsung PAID tanpa invoice, voucher TERPAKAI (BR-08)', async () => {
    // voucher 100rb dibayar dulu
    const vch = await request(app.getHttpServer())
      .post('/api/v1/admin/vouchers')
      .set('Authorization', `Bearer ${superadminToken}`)
      .send({ namaPemberi: 'V E2E', nim: '1234567890', nomorHp: '081234567890', nominal: 100000 });
    expect(vch.status).toBe(201);
    const body = JSON.stringify({ reference: 'E2E-VCH', merchant_ref: `VCH-${vch.body.kodeVoucher ? 900001 : 0}`, status: 'PAID' });
    // ambil id voucher dari kode
    const vRow = await prisma.voucher.findUnique({ where: { kodeVoucher: vch.body.kodeVoucher } });
    const cbBody = JSON.stringify({ reference: 'E2E-VCH', merchant_ref: `VCH-${vRow!.id}`, status: 'PAID', payment_method: 'QRIS' });
    await callback(app, JSON.parse(cbBody), stubSignature(cbBody));
    expect((await prisma.voucher.findUnique({ where: { id: vRow!.id } }))?.status).toBe('AKTIF');

    // PENDING dipakai → ditolak sudah tercakup by status; sekarang order full-cover
    const nim = `2406012${String(Math.floor(Math.random() * 9000) + 1000)}`;
    const ord = await order(nim, vch.body.kodeVoucher);
    expect(ord.status).toBe(201);
    // Decimal.toJSON memangkas nol di belakang ('0.00' → '0') — nilainya tetap nol persis
    expect(Number(ord.body.totalBayar)).toBe(0);
    expect(ord.body.statusPembayaran).toBe('PAID');
    // tidak ada invoice Tripay
    const tRow = await prisma.tiket.findUnique({ where: { id: Number(ord.body.merchantRef.split('-')[1]) } });
    expect(tRow?.dokuInvoiceId).toBeNull();
    expect((await prisma.voucher.findUnique({ where: { id: vRow!.id } }))?.status).toBe('TERPAKAI');
    // rekap format baku FR-7.1a
    const rekap = await prisma.rekap.findFirst({ where: { tiketId: tRow!.id, status: 'SUCCESS' } });
    expect(rekap?.keterangan).toContain('voucher=');
  });

  it('6. voucher sama dipakai 2x → yang kedua 422 VOUCHER_TERPAKAI', async () => {
    const vch = await request(app.getHttpServer())
      .post('/api/v1/admin/vouchers')
      .set('Authorization', `Bearer ${superadminToken}`)
      .send({ namaPemberi: 'V2 E2E', nim: '1234567890', nomorHp: '081234567890', nominal: 100000 });
    const vRow = await prisma.voucher.findUnique({ where: { kodeVoucher: vch.body.kodeVoucher } });
    const cbBody = JSON.stringify({ reference: 'E2E-VCH2', merchant_ref: `VCH-${vRow!.id}`, status: 'PAID', payment_method: 'QRIS' });
    await callback(app, JSON.parse(cbBody), stubSignature(cbBody));

    const nim1 = `2406012${String(Math.floor(Math.random() * 9000) + 1000)}`;
    const first = await order(nim1, vch.body.kodeVoucher);
    expect(first.status).toBe(201);
    const nim2 = `2406012${String(Math.floor(Math.random() * 9000) + 1000)}`;
    const second = await order(nim2, vch.body.kodeVoucher);
    expect(second.status).toBe(422);
    expect(second.body.code).toBe('VOUCHER_TERPAKAI');
  });

  it('7. NIM dobel → 409 NIM_SUDAH_TERDAFTAR (BR-03)', async () => {
    const nim = `2406012${String(Math.floor(Math.random() * 9000) + 1000)}`;
    const first = await order(nim);
    expect(first.status).toBe(201);
    const second = await order(nim);
    expect(second.status).toBe(409);
    expect(second.body.code).toBe('NIM_SUDAH_TERDAFTAR');
  });

  it('8. scan: sukses sekali, dobel → SUDAH_CHECKIN (FR-6)', async () => {
    const nim = `2406012${String(Math.floor(Math.random() * 9000) + 1000)}`;
    const created = await order(nim);
    const id = Number(created.body.merchantRef.split('-')[1]);
    const cbBody = JSON.stringify({ reference: 'E2E-TRX9', merchant_ref: `TKT-${id}`, status: 'PAID', payment_method: 'QRIS' });
    await callback(app, JSON.parse(cbBody), stubSignature(cbBody));
    // tunggu fulfillment (worker inline via BullMQ)
    let qrToken: string | null = null;
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 500));
      const row = await prisma.tiket.findUnique({ where: { id } });
      if (row?.statusTiket === 'ISSUED' && row.qrToken) {
        qrToken = row.qrToken;
        break;
      }
    }
    expect(qrToken).toBeTruthy();

    const scan1 = await request(app.getHttpServer())
      .post('/api/v1/admin/checkin/scan')
      .set('Authorization', `Bearer ${scannerToken}`)
      .send({ qrToken });
    expect(scan1.status).toBe(201);
    expect(scan1.body.nama).toContain('Tester');

    const scan2 = await request(app.getHttpServer())
      .post('/api/v1/admin/checkin/scan')
      .set('Authorization', `Bearer ${scannerToken}`)
      .send({ qrToken });
    expect(scan2.status).toBe(409);
    expect(scan2.body.code).toBe('SUDAH_CHECKIN');
  });

  it('9. stats konsisten dengan rekap; scanner tidak bisa verif-manual (BR-11)', async () => {
    const stats = await request(app.getHttpServer())
      .get('/api/v1/admin/stats')
      .set('Authorization', `Bearer ${superadminToken}`);
    expect(stats.status).toBe(200);

    const rekap = await prisma.rekap.aggregate({
      _sum: { nominal: true },
      where: { status: 'SUCCESS' },
    });
    expect(stats.body.pendapatan.total).toBe((rekap._sum.nominal ?? 0).toString());

    const verif = await request(app.getHttpServer())
      .post('/api/v1/admin/orders/1/verify-manual')
      .set('Authorization', `Bearer ${scannerToken}`);
    expect([403, 409]).toContain(verif.status);
  });
});
