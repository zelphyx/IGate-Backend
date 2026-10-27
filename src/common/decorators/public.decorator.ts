import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';
/** Tandai endpoint tanpa JWT (login, health, callback publik). */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
