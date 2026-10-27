import Joi from 'joi';

/**
 * Validasi env saat boot — aplikasi menolak jalan bila config tidak lengkap (PRD §13).
 * Semua variabel wajib untuk fitur yang menyusul didefinisikan di sini sejak awal
 * agar CP berikutnya tidak mengejutkan deployment.
 */
export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'test', 'production').default('development'),
  APP_PORT: Joi.number().port().default(3000),
  APP_BASE_URL: Joi.string().uri().required(),
  RETURN_URL: Joi.string().uri().required(),

  DATABASE_URL: Joi.string().required(),
  REDIS_URL: Joi.string().required(),

  JWT_SECRET: Joi.string().min(32).required(),
  JWT_REFRESH_SECRET: Joi.string().min(32).required(),

  TICKET_PRICE: Joi.string()
    .pattern(/^\d+(\.\d{1,2})?$/)
    .required(),
  MAX_TICKETS: Joi.number().integer().min(1).required(),
  PAYMENT_EXPIRY_MINUTES: Joi.number().integer().min(1).default(360),
  NIM_REGEX: Joi.string().required(),
  VOUCHER_MIN_NOMINAL: Joi.string()
    .pattern(/^\d+(\.\d{1,2})?$/)
    .required(),
  VOUCHER_MAX_NOMINAL: Joi.string()
    .pattern(/^\d+(\.\d{1,2})?$/)
    .required(),
  EVENT_DATE: Joi.date().iso().optional(),

  TRIPAY_MODE: Joi.string().valid('sandbox', 'production', 'test').default('sandbox'),
  TRIPAY_API_KEY: Joi.string().allow('').default(''),
  TRIPAY_PRIVATE_KEY: Joi.string().allow('').default(''),
  TRIPAY_MERCHANT_CODE: Joi.string().allow('').default(''),
  TRIPAY_CHANNELS: Joi.string().default('QRIS'),

  SMTP_HOST: Joi.string().allow('').default(''),
  SMTP_PORT: Joi.number().port().default(587),
  SMTP_USER: Joi.string().allow('').default(''),
  SMTP_PASS: Joi.string().allow('').default(''),
  MAIL_FROM: Joi.string().allow('').default(''),

  DISCORD_BOT_TOKEN: Joi.string().allow('').default(''),
  DISCORD_GUILD_ID: Joi.string().allow('').default(''),
  DISCORD_LOG_WEBHOOK_URL: Joi.string().uri({ allowRelative: true }).allow('').default(''),
  DISCORD_ERROR_WEBHOOK_URL: Joi.string().uri({ allowRelative: true }).allow('').default(''),
  DISCORD_ALERT_ROLE_ID: Joi.string().allow('').default(''),
  DISCORD_PANITIA_ROLE_ID: Joi.string().allow('').default(''),
  DISCORD_SUPERADMIN_ROLE_ID: Joi.string().allow('').default(''),
  STOCK_ALERT_THRESHOLD: Joi.number().integer().min(1).max(100).default(10),
});
