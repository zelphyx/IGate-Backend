import { SetMetadata } from '@nestjs/common';
import { Role } from '../constants';

export const ROLES_KEY = 'roles';
/** Batasi endpoint ke role tertentu (FR-1.2). Tanpa decorator = semua role login. */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
