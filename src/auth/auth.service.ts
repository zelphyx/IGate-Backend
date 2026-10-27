import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService, JwtSignOptions } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.module';
import { RefreshTokenStore } from './refresh-token.store';
import { JwtPayload } from '../common/interfaces/jwt-payload';

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export interface AdminProfile {
  id: number;
  nama: string;
  email: string;
  role: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly refreshStore: RefreshTokenStore,
  ) {}

  async login(email: string, password: string): Promise<AuthTokens & { admin: AdminProfile }> {
    const admin = await this.prisma.admin.findUnique({ where: { email: email.toLowerCase() } });
    // Perbandingan tetap dijalankan terhadap hash dummy agar timing konsisten.
    const hash = admin?.passwordHash ?? '$2b$12$C6UzMDM.H6dfI/f/IKcEeO7pTn5XnPUbcbC9dDlHhOCXJlpMlfHF6';
    const valid = await bcrypt.compare(password, hash);
    if (!admin || !valid) {
      throw new UnauthorizedException('Email atau password salah.');
    }
    return { ...(await this.issueTokens(admin.id, admin.email, admin.role)), admin: this.toProfile(admin) };
  }

  async refresh(refreshToken: string): Promise<AuthTokens> {
    const adminId = await this.refreshStore.resolve(refreshToken);
    if (!adminId) {
      throw new UnauthorizedException('Refresh token tidak valid atau kedaluwarsa.');
    }
    const admin = await this.prisma.admin.findUnique({ where: { id: adminId } });
    if (!admin) {
      await this.refreshStore.revoke(refreshToken);
      throw new UnauthorizedException('Admin tidak ditemukan.');
    }
    // Rotasi: token lama dicabut, pasangan baru diterbitkan (FR-1.1).
    await this.refreshStore.revoke(refreshToken);
    return this.issueTokens(admin.id, admin.email, admin.role);
  }

  async logout(refreshToken: string): Promise<void> {
    await this.refreshStore.revoke(refreshToken);
  }

  private async issueTokens(id: number, email: string, role: string): Promise<AuthTokens> {
    const payload: JwtPayload = { sub: id, email, role };
    const accessToken = await this.jwt.signAsync(payload, {
      expiresIn: this.config.get<string>('jwtExpiresIn') as JwtSignOptions['expiresIn'],
    });
    const refreshToken = await this.refreshStore.issue(id);
    return { accessToken, refreshToken };
  }

  private toProfile(admin: { id: number; nama: string; email: string; role: string }): AdminProfile {
    return { id: admin.id, nama: admin.nama, email: admin.email, role: admin.role };
  }
}
