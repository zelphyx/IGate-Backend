import { ConfigService } from '@nestjs/config';
import { createHmac } from 'crypto';
import { TripayLiveService, TripayStubService } from './tripay.service';

describe('TripayClient', () => {
  const privateKey = 'PRIVATE_KEY_TEST';
  const merchantCode = 'MCH001';

  function makeLive(): TripayLiveService {
    const config = {
      get: (key: string) =>
        ({
          'tripay.mode': 'sandbox',
          'tripay.merchantCode': merchantCode,
          'tripay.privateKey': privateKey,
          'tripay.apiKey': 'API_KEY',
          'tripay.channels': ['QRIS'],
        })[key],
      getOrThrow: (key: string) =>
        ({
          'tripay.merchantCode': merchantCode,
          'tripay.privateKey': privateKey,
          'tripay.apiKey': 'API_KEY',
          appBaseUrl: 'http://localhost:3000',
        })[key] as string,
    } as unknown as ConfigService;
    return new TripayLiveService(config);
  }

  it('signature create transaction = HMAC-SHA256(merchantCode+merchantRef+amount, privateKey)', () => {
    const live = makeLive();
    const expected = createHmac('sha256', privateKey)
      .update(`${merchantCode}TKT-1${100000}`)
      .digest('hex');
    expect(live.createSignature('TKT-1', 100000)).toBe(expected);
  });

  it('verifyCallbackSignature: HMAC raw body valid → true', () => {
    const live = makeLive();
    const raw = Buffer.from('{"status":"PAID"}');
    const sig = createHmac('sha256', privateKey).update(raw).digest('hex');
    expect(live.verifyCallbackSignature(raw, sig)).toBe(true);
  });

  it('verifyCallbackSignature: signature salah → false', () => {
    const live = makeLive();
    const raw = Buffer.from('{"status":"PAID"}');
    expect(live.verifyCallbackSignature(raw, 'deadbeef')).toBe(false);
  });

  it('verifyCallbackSignature: signature tidak ada → false', () => {
    const live = makeLive();
    expect(live.verifyCallbackSignature(Buffer.from('{}'), undefined)).toBe(false);
  });

  it('stub: buat transaksi fixture tanpa internet', async () => {
    const stub = new TripayStubService();
    const trx = await stub.createTransaction({
      merchantRef: 'TKT-9',
      amount: 100000,
      expiredMinutes: 360,
      customerName: 'Budi',
      customerEmail: 'budi@mail.id',
      customerPhone: '08123456789',
      orderItemName: 'Tiket IGATE',
    });
    expect(trx.reference).toBe('TEST-TKT-9');
    expect(trx.checkoutUrl).toContain('TKT-9');
    expect(stub.verifyCallbackSignature(Buffer.from('x'), 'valid-1')).toBe(true);
  });
});
