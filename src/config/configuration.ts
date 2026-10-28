export const configuration = () => ({
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: parseInt(process.env.APP_PORT ?? '3000', 10),
  appBaseUrl: process.env.APP_BASE_URL ?? 'http://localhost:3000',
  returnUrl: process.env.RETURN_URL ?? 'http://localhost:3000/return',
  corsOrigins: (process.env.CORS_ORIGINS ?? 'http://localhost:5173')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  storageDir: process.env.STORAGE_DIR ?? 'storage',

  databaseUrl: process.env.DATABASE_URL,
  redisUrl: process.env.REDIS_URL,

  jwtSecret: process.env.JWT_SECRET,
  jwtRefreshSecret: process.env.JWT_REFRESH_SECRET,
  jwtExpiresIn: '15m',
  jwtRefreshExpiresIn: '7d',

  ticketPrice: process.env.TICKET_PRICE ?? '0',
  maxTickets: parseInt(process.env.MAX_TICKETS ?? '0', 10),
  paymentExpiryMinutes: parseInt(process.env.PAYMENT_EXPIRY_MINUTES ?? '360', 10),
  nimRegex: new RegExp(process.env.NIM_REGEX ?? '^2406012\\d{3,4}$'),
  voucherMinNominal: process.env.VOUCHER_MIN_NOMINAL ?? '10000',
  voucherMaxNominal: process.env.VOUCHER_MAX_NOMINAL ?? '10000000',
  eventDate: process.env.EVENT_DATE ? new Date(process.env.EVENT_DATE) : undefined,

  tripay: {
    mode: process.env.TRIPAY_MODE ?? 'sandbox',
    apiKey: process.env.TRIPAY_API_KEY,
    privateKey: process.env.TRIPAY_PRIVATE_KEY,
    merchantCode: process.env.TRIPAY_MERCHANT_CODE,
    channels: (process.env.TRIPAY_CHANNELS ?? 'QRIS').split(',').map((s) => s.trim()),
  },

  smtp: {
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT ?? '587', 10),
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
    from: process.env.MAIL_FROM,
  },

  discord: {
    botToken: process.env.DISCORD_BOT_TOKEN,
    guildId: process.env.DISCORD_GUILD_ID,
    logWebhookUrl: process.env.DISCORD_LOG_WEBHOOK_URL,
    errorWebhookUrl: process.env.DISCORD_ERROR_WEBHOOK_URL,
    alertRoleId: process.env.DISCORD_ALERT_ROLE_ID,
    panitiaRoleId: process.env.DISCORD_PANITIA_ROLE_ID,
    adminRoleId: process.env.DISCORD_ADMIN_ROLE_ID,
    superadminRoleId: process.env.DISCORD_SUPERADMIN_ROLE_ID,
    stockAlertThreshold: parseInt(process.env.STOCK_ALERT_THRESHOLD ?? '10', 10),
  },
});

export default configuration;
