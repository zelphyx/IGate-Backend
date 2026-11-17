import { ConfigService } from '@nestjs/config';
import {
  BelibayarLiveService,
  BelibayarStubService,
  mapBelibayarStatus,
  normalizeExpiryMinutes,
  normalizePhone,
  parseCallbackJson,
} from './belibayar.service';
import { createHmac } from 'crypto';

describe('BelibayarLiveService', () => {
  const apiKey = 'byr_live_test123';
  const secretKey = 'secret-test-key';
  const webhookSecret = 'webhook-secret-key';

  const createService = (mode = 'production') => {
    const config = {
      get: jest.fn((k: string) => {
        const map: Record<string, unknown> = {
          'belibayar.mode': mode,
          'belibayar.apiKey': apiKey,
          'belibayar.secretKey': secretKey,
          'belibayar.webhookSecret': webhookSecret,
          'belibayar.channels': ['va_bca', 'qris'],
          returnUrl: 'https://igate.local/return',
        };
        return map[k];
      }),
      getOrThrow: jest.fn((k: string) => {
        if (k === 'belibayar.apiKey') return apiKey;
        if (k === 'belibayar.secretKey') return secretKey;
        if (k === 'belibayar.webhookSecret') return webhookSecret;
        throw new Error(`Missing ${k}`);
      }),
    } as unknown as ConfigService;

    return new BelibayarLiveService(config);
  };

  it('generateSignature menghitung HMAC-SHA256 hex yang benar', () => {
    const live = createService();
    const payload = '{"reference":"TKT-1","amount":100000}';
    const expected = createHmac('sha256', secretKey).update(payload).digest('hex');
    expect(live.generateSignature(payload, secretKey)).toBe(expected);
  });

  it('verifyCallbackSignature mengembalikan true bila signature cocok dengan webhook_secret', () => {
    const live = createService();
    const body = Buffer.from(JSON.stringify({ reference: 'TKT-1', status: 'paid' }));
    const validSig = createHmac('sha256', webhookSecret).update(body).digest('hex');

    expect(live.verifyCallbackSignature(body, validSig)).toBe(true);
  });

  it('verifyCallbackSignature mengembalikan false bila signature berbeda', () => {
    const live = createService();
    const body = Buffer.from(JSON.stringify({ reference: 'TKT-1', status: 'paid' }));
    expect(live.verifyCallbackSignature(body, 'invalid_signature_hex')).toBe(false);
    expect(live.verifyCallbackSignature(body, undefined)).toBe(false);
  });

  it('normalizeExpiryMinutes memilih nilai terdekat dari daftar yang didukung Belibayar', () => {
    expect(normalizeExpiryMinutes(360)).toBe(360);
    expect(normalizeExpiryMinutes(30)).toBe(30);
    expect(normalizeExpiryMinutes(45)).toBe(30); // 45 lebih dekat ke 30 daripada 60 (selisih 15 vs 15 -> 30)
    expect(normalizeExpiryMinutes(700)).toBe(720);
    expect(normalizeExpiryMinutes(2000)).toBe(1440);
  });

  it('createQrisTransaction mengirim body payment/charge & memetakan qr_content', async () => {
    const live = createService();
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        data: {
          reference: 'TKT-9',
          amount: 45000,
          status: 'pending',
          qr_content: '00020101021226610014COM.BELIBAYARREAL',
          qr_url: 'https://link.belibayar.id/v1/qris/QRX.png',
          expired_at: Math.floor(Date.now() / 1000) + 3600,
        },
      }),
    });
    jest.spyOn(global, 'fetch').mockImplementation(fetchMock as unknown as typeof fetch);

    const res = await live.createQrisTransaction({
      merchantRef: 'TKT-9',
      amount: 45000,
      expiredMinutes: 60,
      customerName: 'Budi',
      customerEmail: 'budi@mail.id',
      customerPhone: '081234567890',
      orderItemName: 'Tiket IGATE',
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/direct/v1/payment/charge');
    const body = JSON.parse(String(init.body));
    expect(body.reference).toBe('TKT-9');
    expect(body.amount).toBe(45000);
    expect(body.pay_method).toEqual({ method: 'qris' });
    expect(body.static_qr).toBe(false);
    expect(typeof body.expired_time).toBe('number');
    // X-Signature = HMAC atas raw body (canonical POST)
    const expectedSig = createHmac('sha256', secretKey).update(String(init.body)).digest('hex');
    expect((init.headers as Record<string, string>)['X-Signature']).toBe(expectedSig);

    expect(res.qrContent).toBe('00020101021226610014COM.BELIBAYARREAL');
    expect(res.qrUrl).toBe('https://link.belibayar.id/v1/qris/QRX.png');
    expect(res.checkoutUrl).toBe('');
    jest.restoreAllMocks();
  });

  it('getChargeTransactionDetail memakai canonical ":" + timestamp (X-Timestamp)', async () => {
    const live = createService();
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        data: { reference: 'TKT-9', status: 'paid', amount: 45000, payment_channel: 'QRIS' },
      }),
    });
    jest.spyOn(global, 'fetch').mockImplementation(fetchMock as unknown as typeof fetch);

    const res = await live.getChargeTransactionDetail('TKT-9');

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/direct/v1/payment/status/TKT-9');
    const ts = (init.headers as Record<string, string>)['X-Timestamp'];
    const expectedSig = createHmac('sha256', secretKey).update(`:${ts}`).digest('hex');
    expect((init.headers as Record<string, string>)['X-Signature']).toBe(expectedSig);
    expect(res.status).toBe('PAID');
    expect(res.paymentMethod).toBe('QRIS');
    jest.restoreAllMocks();
  });

  it('normalizePhone membersihkan dan memformat nomor HP menjadi 628xxx', () => {
    expect(normalizePhone('081234567890')).toBe('6281234567890');
    expect(normalizePhone('+6281234567890')).toBe('6281234567890');
    expect(normalizePhone('6281234567890')).toBe('6281234567890');
  });

  it('mapBelibayarStatus memetakan status Belibayar ke status tiket internal', () => {
    expect(mapBelibayarStatus('paid')).toBe('PAID');
    expect(mapBelibayarStatus('success')).toBe('PAID');
    expect(mapBelibayarStatus('expired')).toBe('EXPIRED');
    expect(mapBelibayarStatus('cancelled')).toBe('FAILED');
    expect(mapBelibayarStatus('failed')).toBe('FAILED');
    expect(mapBelibayarStatus('unknown')).toBe('UNKNOWN');
  });

  it('parseCallbackJson memproses format webhook resmi Belibayar', () => {
    const raw = JSON.stringify({
      reference: 'TKT-10',
      transaction_id: 'TRX-BYR-999',
      payment_method: 'virtual_account',
      payment_channel: 'BCA',
      amount: 100000,
      status: 'paid',
      paid_at: 1783279088,
    });

    const parsed = parseCallbackJson(raw);
    expect(parsed.merchant_ref).toBe('TKT-10');
    expect(parsed.reference).toBe('TRX-BYR-999');
    expect(parsed.status).toBe('PAID');
    expect(parsed.payment_method).toBe('BCA');
    expect(parsed.amount).toBe(100000);
  });

  it('parseCallbackJson memproses fallback format legacy', () => {
    const raw = JSON.stringify({
      order: { invoice_number: 'TKT-20', amount: 50000 },
      transaction: { original_request_id: 'LEGACY-REQ-1', status: 'SUCCESS' },
      channel: { id: 'VIRTUAL_ACCOUNT_BNI' },
    });

    const parsed = parseCallbackJson(raw);
    expect(parsed.merchant_ref).toBe('TKT-20');
    expect(parsed.reference).toBe('LEGACY-REQ-1');
    expect(parsed.status).toBe('PAID');
    expect(parsed.payment_method).toBe('VIRTUAL_ACCOUNT_BNI');
    expect(parsed.amount).toBe(50000);
  });
});

describe('BelibayarStubService', () => {
  const stub = new BelibayarStubService();

  it('verifyCallbackSignature menerima signature valid-length atau valid-x', () => {
    const body = '{"status":"paid"}';
    expect(stub.verifyCallbackSignature(body, `valid-${body.length}`)).toBe(true);
    expect(stub.verifyCallbackSignature(body, 'valid-x')).toBe(true);
    expect(stub.verifyCallbackSignature(body, 'salah')).toBe(false);
  });

  it('createTransaction menghasilkan checkoutUrl mock Belibayar', async () => {
    const res = await stub.createTransaction({
      merchantRef: 'TKT-5',
      amount: 100000,
      expiredMinutes: 60,
      customerName: 'Tester',
      customerEmail: 'tester@igate.local',
      customerPhone: '081234567890',
      orderItemName: 'Tiket',
    });

    expect(res.merchantRef).toBe('TKT-5');
    expect(res.checkoutUrl).toBe('https://link.belibayar.id/mock-TKT-5');
    expect(res.amount).toBe(100000);
  });
});

