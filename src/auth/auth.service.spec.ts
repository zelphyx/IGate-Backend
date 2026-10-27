import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
import { AuthService } from './auth.service';
import { RefreshTokenStore } from './refresh-token.store';
import { PrismaService } from '../prisma/prisma.module';

describe('AuthService', () => {
  let service: AuthService;
  let prisma: { admin: { findUnique: jest.Mock } };
  let jwt: { signAsync: jest.Mock };
  let store: { issue: jest.Mock; resolve: jest.Mock; revoke: jest.Mock };

  const PASSWORD = 'password-aman-123';
  // Cost rendah cukup untuk unit test (bukan hash produksi).
  let superadmin: { id: number; nama: string; email: string; passwordHash: string; role: string };

  beforeAll(async () => {
    superadmin = {
      id: 1,
      nama: 'Ketua',
      email: 'ketua@igate.id',
      passwordHash: await bcrypt.hash(PASSWORD, 4),
      role: 'superadmin',
    };
  });

  beforeEach(async () => {
    prisma = { admin: { findUnique: jest.fn() } };
    jwt = { signAsync: jest.fn().mockResolvedValue('access-token') };
    store = { issue: jest.fn().mockResolvedValue('refresh-token'), resolve: jest.fn(), revoke: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: prisma },
        { provide: JwtService, useValue: jwt },
        { provide: ConfigService, useValue: { get: jest.fn().mockReturnValue('15m') } },
        { provide: RefreshTokenStore, useValue: store },
      ],
    }).compile();

    service = moduleRef.get(AuthService);
  });

  describe('login', () => {
    it('menolak password salah → UnauthorizedException', async () => {
      prisma.admin.findUnique.mockResolvedValue(superadmin);
      await expect(service.login('ketua@igate.id', 'password-salah-123')).rejects.toThrow(
        UnauthorizedException,
      );
      expect(store.issue).not.toHaveBeenCalled();
    });

    it('menolak email tidak terdaftar → UnauthorizedException (timing tetap terhadap hash dummy)', async () => {
      prisma.admin.findUnique.mockResolvedValue(null);
      await expect(service.login('unknown@igate.id', PASSWORD)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('login sukses → access + refresh token + profil tanpa hash', async () => {
      prisma.admin.findUnique.mockResolvedValue(superadmin);
      const result = await service.login('ketua@igate.id', PASSWORD);
      expect(result).toEqual({
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        admin: { id: 1, nama: 'Ketua', email: 'ketua@igate.id', role: 'superadmin' },
      });
      expect(store.issue).toHaveBeenCalledWith(1);
    });

    it('lookup email dinormalisasi ke lowercase', async () => {
      prisma.admin.findUnique.mockResolvedValue(superadmin);
      await service.login('KETUA@IGATE.ID', PASSWORD);
      expect(prisma.admin.findUnique).toHaveBeenCalledWith({ where: { email: 'ketua@igate.id' } });
    });
  });

  describe('refresh', () => {
    it('token tidak dikenal → UnauthorizedException', async () => {
      store.resolve.mockResolvedValue(null);
      await expect(service.refresh('token-abal')).rejects.toThrow(UnauthorizedException);
    });

    it('rotasi: token lama dicabut lalu pasangan baru diterbitkan', async () => {
      store.resolve.mockResolvedValue(1);
      prisma.admin.findUnique.mockResolvedValue(superadmin);
      const tokens = await service.refresh('token-lama');
      expect(store.revoke).toHaveBeenCalledWith('token-lama');
      expect(store.issue).toHaveBeenCalledWith(1);
      expect(tokens.accessToken).toBe('access-token');
    });

    it('admin sudah terhapus → token dicabut dan ditolak', async () => {
      store.resolve.mockResolvedValue(99);
      prisma.admin.findUnique.mockResolvedValue(null);
      await expect(service.refresh('token-yatim')).rejects.toThrow(UnauthorizedException);
      expect(store.revoke).toHaveBeenCalledWith('token-yatim');
    });
  });
});
