import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from './roles.guard';
import { ROLES } from '../constants';
import { JwtPayload } from '../interfaces/jwt-payload';

function makeGuard(handlerRoles: typeof ROLES[keyof typeof ROLES][] | undefined): RolesGuard {
  const reflector = {
    getAllAndOverride: jest.fn().mockReturnValue(handlerRoles),
  } as unknown as Reflector;
  return new RolesGuard(reflector);
}

function contextWith(user: JwtPayload | undefined): ExecutionContext {
  return {
    getHandler: () => () => undefined,
    getClass: () => class {},
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
}

describe('RolesGuard', () => {
  const panitia: JwtPayload = { sub: 1, email: 'a@b.id', role: ROLES.SCANNER };

  it('tanpa @Roles() → semua role login boleh', () => {
    expect(makeGuard(undefined).canActivate(contextWith(panitia))).toBe(true);
  });

  it('role sesuai @Roles() → true', () => {
    expect(makeGuard([ROLES.SUPERADMIN, ROLES.ADMIN]).canActivate(contextWith({ ...panitia, role: ROLES.ADMIN }))).toBe(true);
  });

  it('role tidak sesuai @Roles() → false', () => {
    expect(makeGuard([ROLES.SUPERADMIN]).canActivate(contextWith(panitia))).toBe(false);
  });

  it('user tidak ada (belum login) pada endpoint ber-role → false', () => {
    expect(makeGuard([ROLES.ADMIN]).canActivate(contextWith(undefined))).toBe(false);
  });
});
