import { ConfigService } from '@nestjs/config';
import {
  BelibayarLiveService,
  BelibayarStubService,
  FALLBACK_CUSTOMER_NAME,
  mapBelibayarStatus,
  normalizeExpiryMinutes,
  normalizePhone,
  parseCallbackJson,
  sanitizeCustomerName,
} from './belibayar.service';
import { BelibayarError, describeBelibayarError } from './belibayar.types';
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

  describe('request: percobaan ulang & detail error', () => {
    const input = {
      merchantRef: 'TKT-9',
      amount: 45000,
      expiredMinutes: 60,
      customerName: 'Budi',
      customerEmail: 'budi@mail.id',
      customerPhone: '081234567890',
      orderItemName: 'Tiket IGATE',
    };
    const okResponse = {
      ok: true,
      json: async () => ({ success: true, data: { reference: 'TKT-9', amount: 45000, qr_content: 'QR' } }),
    };
    const httpError = (status: number, messages: unknown) => ({
      ok: false,
      status,
      json: async () => ({ success: false, messages }),
    });
    const netError = (code: string) => Object.assign(new TypeError('fetch failed'), { cause: { code } });
    const mockFetch = (...impls: Array<() => unknown>) => {
      const fn = jest.fn();
      impls.forEach((impl) => fn.mockImplementationOnce(impl as never));
      jest.spyOn(global, 'fetch').mockImplementation(fn as unknown as typeof fetch);
      return fn;
    };
    const fastService = () => {
      const live = createService();
      jest
        .spyOn(live as unknown as { retryDelayMs(attempt: number): number }, 'retryDelayMs')
        .mockReturnValue(0);
      return live;
    };
    afterEach(() => jest.restoreAllMocks());

    it('mengulang kegagalan jaringan sampai 3 percobaan lalu berhasil', async () => {
      const fetchFn = mockFetch(
        () => Promise.reject(netError('ECONNRESET')),
        () => Promise.reject(netError('EAI_AGAIN')),
        () => Promise.resolve(okResponse),
      );
      const res = await fastService().createQrisTransaction(input);
      expect(fetchFn).toHaveBeenCalledTimes(3);
      expect(res.qrContent).toBe('QR');
    });

    it('3 kali gagal jaringan → BelibayarError membawa kode penyebab', async () => {
      const fetchFn = mockFetch(
        () => Promise.reject(netError('ECONNRESET')),
        () => Promise.reject(netError('ECONNRESET')),
        () => Promise.reject(netError('ECONNRESET')),
      );
      const err = await fastService().createQrisTransaction(input).catch((e: unknown) => e);
      expect(fetchFn).toHaveBeenCalledTimes(3);
      expect(err).toBeInstanceOf(BelibayarError);
      expect((err as BelibayarError).code).toBe('ECONNRESET');
      expect((err as BelibayarError).status).toBeUndefined();
      expect((err as BelibayarError).describe()).toContain('jaringan ECONNRESET');
    });

    it('timeout dicatat sebagai kode TIMEOUT', async () => {
      const timeout = Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });
      mockFetch(
        () => Promise.reject(timeout),
        () => Promise.reject(timeout),
        () => Promise.reject(timeout),
      );
      const err = await fastService().createQrisTransaction(input).catch((e: unknown) => e);
      expect((err as BelibayarError).code).toBe('TIMEOUT');
    });

    it('HTTP 429 diulang (ditolak sebelum diproses)', async () => {
      const fetchFn = mockFetch(
        () => Promise.resolve(httpError(429, 'Too many requests')),
        () => Promise.resolve(okResponse),
      );
      await fastService().createQrisTransaction(input);
      expect(fetchFn).toHaveBeenCalledTimes(2);
    });

    it('HTTP 422 tidak diulang dan membawa status, pesan, serta cuplikan jawaban', async () => {
      const fetchFn = mockFetch(() => Promise.resolve(httpError(422, ['Request body tidak valid', 'customer_email invalid'])));
      const err = await fastService().createQrisTransaction(input).catch((e: unknown) => e);
      expect(fetchFn).toHaveBeenCalledTimes(1);
      expect((err as BelibayarError).status).toBe(422);
      expect((err as BelibayarError).message).toBe('Request body tidak valid; customer_email invalid');
      expect((err as BelibayarError).detail).toContain('customer_email invalid');
      expect(describeBelibayarError(err)).toBe('HTTP 422: Request body tidak valid; customer_email invalid');
    });

    it('HTTP 502 pada POST tidak diulang (cegah tagihan ganda)', async () => {
      const fetchFn = mockFetch(() => Promise.resolve(httpError(502, 'Bad gateway')));
      const err = await fastService().createQrisTransaction(input).catch((e: unknown) => e);
      expect(fetchFn).toHaveBeenCalledTimes(1);
      expect((err as BelibayarError).status).toBe(502);
    });

    it('HTTP 503 pada GET (cek status) diulang', async () => {
      const fetchFn = mockFetch(
        () => Promise.resolve(httpError(503, 'Unavailable')),
        () =>
          Promise.resolve({
            ok: true,
            json: async () => ({ success: true, data: { reference: 'TKT-9', status: 'paid', amount: 45000 } }),
          }),
      );
      const res = await fastService().getChargeTransactionDetail('TKT-9');
      expect(fetchFn).toHaveBeenCalledTimes(2);
      expect(res.status).toBe('PAID');
    });

    it('jawaban error bukan JSON tetap menghasilkan BelibayarError berstatus', async () => {
      mockFetch(() =>
        Promise.resolve({
          ok: false,
          status: 400,
          json: async () => {
            throw new SyntaxError('Unexpected token <');
          },
        }),
      );
      const err = await fastService().createQrisTransaction(input).catch((e: unknown) => e);
      expect((err as BelibayarError).status).toBe(400);
      expect((err as BelibayarError).detail).toBe('jawaban bukan JSON');
    });
  });

  describe('customer_name sesuai aturan Belibayar (5–25, alfanumerik/spasi/_/-, tanpa awalan PT/CV)', () => {
    it.each([
      ['Budi Santoso', 'Budi Santoso'],
      ["Siti Nur'aini", 'Siti Nur aini'],
      ['PT. Maju Jaya', 'Maju Jaya'],
      ['CV Sumber Rejeki', 'Sumber Rejeki'],
      ['Ani', 'Ani IGATE'],
      ['Budi', 'Budi IGATE'],
      ['  A.B.  ', 'A B IGATE'],
      ['Muhammad Abdurrahman Al-Faruq Hakim', 'Muhammad Abdurrahman Al-F'],
      ['José Ñandú', 'Jose Nandu'],
      ['Udin Sedunia', 'Udin Sedunia'],
      ['Putri Ayu', 'Putri Ayu'],
      ['Ahmad_Fauzi-99', 'Ahmad_Fauzi-99'],
      ['王小明', FALLBACK_CUSTOMER_NAME],
      ['CV', FALLBACK_CUSTOMER_NAME],
      ['', FALLBACK_CUSTOMER_NAME],
    ])('sanitizeCustomerName(%j) → %j', (raw, expected) => {
      expect(sanitizeCustomerName(raw)).toBe(expected);
    });

    it('hasil selalu memenuhi aturan untuk berbagai masukan aneh', () => {
      const inputs = ['', ' ', 'A', 'AB', "O'Brien-Smith Jr.", 'PT PT PT', 'x'.repeat(80), '😀😀😀', 'Dr. H. Ahmad Zaki, S.Kom., M.T.'];
      for (const raw of inputs) {
        const out = sanitizeCustomerName(raw);
        expect(out).toMatch(/^[A-Za-z0-9 _-]{5,25}$/);
        expect(out).not.toMatch(/^(pt|cv|ud|pd)\b/i);
      }
    });

    it('createQrisTransaction mengirim nama yang sudah disaring', async () => {
      const live = createService();
      const fetchFn = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ success: true, data: { reference: 'TKT-9', amount: 45000, qr_content: 'QR' } }),
      });
      jest.spyOn(global, 'fetch').mockImplementation(fetchFn as unknown as typeof fetch);
      await live.createQrisTransaction({
        merchantRef: 'TKT-9',
        amount: 45000,
        expiredMinutes: 60,
        customerName: "Siti Nur'aini",
        customerEmail: 'siti@mail.id',
        customerPhone: '081234567890',
        orderItemName: 'Tiket IGATE',
      });
      const body = JSON.parse(String((fetchFn.mock.calls[0] as [string, RequestInit])[1].body));
      expect(body.customer_name).toBe('Siti Nur aini');
      jest.restoreAllMocks();
    });

    it('Belibayar tetap menolak customer_name → diulang sekali dengan nama generik', async () => {
      const live = createService();
      jest
        .spyOn(live as unknown as { retryDelayMs(attempt: number): number }, 'retryDelayMs')
        .mockReturnValue(0);
      const fetchFn = jest
        .fn()
        .mockResolvedValueOnce({
          ok: false,
          status: 400,
          json: async () => ({
            success: false,
            messages: 'Request body tidak valid',
            data: { code: 'VALIDATION_ERROR', fields: { customer_name: '5-25 chars' } },
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ success: true, data: { reference: 'TKT-9', amount: 45000, qr_content: 'QR' } }),
        });
      jest.spyOn(global, 'fetch').mockImplementation(fetchFn as unknown as typeof fetch);
      const res = await live.createQrisTransaction({
        merchantRef: 'TKT-9',
        amount: 45000,
        expiredMinutes: 60,
        customerName: 'Budi Santoso',
        customerEmail: 'budi@mail.id',
        customerPhone: '081234567890',
        orderItemName: 'Tiket IGATE',
      });
      expect(fetchFn).toHaveBeenCalledTimes(2);
      const second = JSON.parse(String((fetchFn.mock.calls[1] as [string, RequestInit])[1].body));
      expect(second.customer_name).toBe(FALLBACK_CUSTOMER_NAME);
      expect(res.qrContent).toBe('QR');
      jest.restoreAllMocks();
    });

    it('400 validasi di field lain tidak diulang', async () => {
      const live = createService();
      const fetchFn = jest.fn().mockResolvedValue({
        ok: false,
        status: 400,
        json: async () => ({
          success: false,
          messages: 'Request body tidak valid',
          data: { code: 'VALIDATION_ERROR', fields: { customer_email: 'invalid' } },
        }),
      });
      jest.spyOn(global, 'fetch').mockImplementation(fetchFn as unknown as typeof fetch);
      const err = await live
        .createQrisTransaction({
          merchantRef: 'TKT-9',
          amount: 45000,
          expiredMinutes: 60,
          customerName: 'Budi Santoso',
          customerEmail: 'bukan-email',
          customerPhone: '081234567890',
          orderItemName: 'Tiket IGATE',
        })
        .catch((e: unknown) => e);
      expect(fetchFn).toHaveBeenCalledTimes(1);
      expect((err as BelibayarError).status).toBe(400);
      jest.restoreAllMocks();
    });
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

