import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.module';
import { CreateAdminDto, UpdateAdminDto } from './dto/admin.dto';
import { ROLES } from '../common/constants';
import { AdminProfile } from '../auth/auth.service';

@Injectable()
export class AdminService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateAdminDto): Promise<AdminProfile> {
    const email = dto.email.toLowerCase();
    const exists = await this.prisma.admin.findUnique({ where: { email } });
    if (exists) {
      throw new ConflictException('Email sudah terdaftar.');
    }
    const admin = await this.prisma.admin.create({
      data: {
        nama: dto.nama,
        email,
        passwordHash: await bcrypt.hash(dto.password, 12),
        role: dto.role,
      },
    });
    return this.toProfile(admin);
  }

  async findAll(): Promise<AdminProfile[]> {
    const admins = await this.prisma.admin.findMany({ orderBy: { id: 'asc' } });
    return admins.map((a) => this.toProfile(a));
  }

  async update(id: number, dto: UpdateAdminDto, actorId: number): Promise<AdminProfile> {
    const admin = await this.prisma.admin.findUnique({ where: { id } });
    if (!admin) {
      throw new NotFoundException('Admin tidak ditemukan.');
    }
    // Superadmin tidak boleh menurunkan role / mengubah dirinya secara merugikan:
    // perubahan role pada diri sendiri diblokir (hindari terkunci tanpa superadmin).
    if (id === actorId && dto.role && dto.role !== admin.role) {
      throw new ForbiddenException('Tidak bisa mengubah role diri sendiri.');
    }
    const updated = await this.prisma.admin.update({
      where: { id },
      data: {
        nama: dto.nama,
        role: dto.role,
        passwordHash: dto.password ? await bcrypt.hash(dto.password, 12) : undefined,
      },
    });
    return this.toProfile(updated);
  }

  async remove(id: number, actorId: number): Promise<void> {
    if (id === actorId) {
      throw new ForbiddenException('Tidak bisa menghapus akun sendiri.');
    }
    const admin = await this.prisma.admin.findUnique({ where: { id } });
    if (!admin) {
      throw new NotFoundException('Admin tidak ditemukan.');
    }
    if (admin.role === ROLES.SUPERADMIN) {
      const superadmins = await this.prisma.admin.count({ where: { role: ROLES.SUPERADMIN } });
      if (superadmins <= 1) {
        throw new ForbiddenException('Harus ada minimal satu superadmin.');
      }
    }
    await this.prisma.admin.delete({ where: { id } });
  }

  private toProfile(admin: { id: number; nama: string; email: string; role: string }): AdminProfile {
    return { id: admin.id, nama: admin.nama, email: admin.email, role: admin.role };
  }
}
