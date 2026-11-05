import { ConfigService } from '@nestjs/config';
import { createHmac, createHash } from 'crypto';
import { DokuLiveService, DokuStubService } from './doku.service';

describe('DokuClient', () => {
  const secretKey = 'SK-TEST-SECRET';
  const clientId = 'BRN-0214-1714016624673';

  function makeLive(): DokuLiveService {
    const config = {
      get: (key: string) =>
        ({
          'doku.mode': 'sandbox',
          'doku.clientId': clientId,
          'doku.secretKey': secretKey,
          'doku.channels': ['VIRTUAL_ACCOUNT_BCA'],
        })[key],
      getOrThrow: (key: string) =>
        ({
          'doku.clientId': clientId,
          'doku.secretKey': secretKey,
          'doku.channels': ['VIRTUAL_ACCOUNT_BCA'],
          returnUrl: 'http://localhost:3000/return',
        })[key] as string,
    } as unknown as ConfigService;
    return new DokuLiveService(config);
  }

  it('generateDigest = SHA-256 base64 dari body', () => {
    const live = makeLive();
    const body = '{"order":{"amount":150000}}';
    const expected = createHash('sha256').update(body, 'utf-8').digest('base64');
    expect(live.generateDigest(body)).toBe(expected);
  });

  it('generateSignature = HMACSHA256= base64 atas komponen baku DOKU', () => {
    const live = makeLive();
    const digest = '5WIYK2TJg6iiZ0d5v4IXSR0EkYEkYOezJIma3Ufli5s=';
    const expected = `HMACSHA256=${createHmac('sha256', secretKey)
      .update(
        `Client-Id:${clientId}\nRequest-Id:req-1\nRequest-Timestamp:2020-08-11T08:45:42Z\nRequest-Target:/checkout/v1/payment\nDigest:${digest}`,
      )
      .digest('base64')}`;
    expect(live.generateSignature(clientId, 'req-1', '2020-08-11T08:45:42Z', '/checkout/v1/payment', digest, secretKey)).toBe(
      expected,
    );
  });

  it('generateSignature tanpa digest (GET) → komponen tanpa baris Digest', () => {
    const live = makeLive();
    const expected = `HMACSHA256=${createHmac('sha256', secretKey)
      .update(
        `Client-Id:${clientId}\nRequest-Id:req-2\nRequest-Timestamp:2020-08-11T08:45:42Z\nRequest-Target:/orders/v1/status/INV-1`,
      )
      .digest('base64')}`;
    expect(live.generateSignature(clientId, 'req-2', '2020-08-11T08:45:42Z', '/orders/v1/status/INV-1', '', secretKey)).toBe(
      expected,
    );
  });

  it('verifyCallbackSignature: header lengkap + signature valid → true', () => {
    const live = makeLive();
    const raw = Buffer.from('{"order":{"invoice_number":"TKT-1"}}');
    const target = '/api/v1/payments/callback';
    const digest = createHash('sha256').update(raw).digest('base64');
    const component = `Client-Id:${clientId}\nRequest-Id:rid\nRequest-Timestamp:2024-01-01T00:00:00Z\nRequest-Target:${target}\nDigest:${digest}`;
    const signature = `HMACSHA256=${createHmac('sha256', secretKey).update(component).digest('base64')}`;
    expect(
      live.verifyCallbackSignature(
        raw,
        { clientId, requestId: 'rid', requestTimestamp: '2024-01-01T00:00:00Z', signature },
        target,
      ),
    ).toBe(true);
  });

  it('verifyCallbackSignature: signature salah → false', () => {
    const live = makeLive();
    expect(
      live.verifyCallbackSignature(
        Buffer.from('{}'),
        { clientId, requestId: 'rid', requestTimestamp: '2024-01-01T00:00:00Z', signature: 'HMACSHA256=deadbeef' },
        '/api/v1/payments/callback',
      ),
    ).toBe(false);
  });

  it('verifyCallbackSignature: header tidak lengkap → false', () => {
    const live = makeLive();
    expect(
      live.verifyCallbackSignature(Buffer.from('{}'), { signature: 'HMACSHA256=x' }, '/api/v1/payments/callback'),
    ).toBe(false);
  });

  it('stub: buat transaksi fixture tanpa internet', async () => {
    const stub = new DokuStubService();
    const trx = await stub.createTransaction({
      merchantRef: 'TKT-9',
      amount: 100000,
      expiredMinutes: 360,
      customerName: 'Budi',
      customerEmail: 'budi@mail.id',
      customerPhone: '08123456789',
      orderItemName: 'Tiket IGATE',
    });
    expect(trx.reference).toBe('TKT-9');
    expect(trx.checkoutUrl).toContain('TKT-9');
    expect(stub.verifyCallbackSignature(Buffer.from('x'), { signature: 'valid-1' }, '/x')).toBe(true);  });
});
