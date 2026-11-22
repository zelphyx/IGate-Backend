-- Token acak 32-char untuk endpoint status publik (menggantikan TKT-{id} sekuensial yang
-- rawan enumerasi — revisi keamanan 2026-11). Existing rows di-backfill oleh deploy script.
ALTER TABLE `tiket` ADD COLUMN `public_token` VARCHAR(40) NOT NULL DEFAULT '';

-- Backfill token acak unik untuk baris existing (sebelum unique index)
UPDATE `tiket`
SET `public_token` = SUBSTRING(MD5(CONCAT(UUID(), `id`)), 1, 32)
WHERE `public_token` = '';

ALTER TABLE `tiket` ADD UNIQUE INDEX `tiket_public_token_key`(`public_token`);
ALTER TABLE `tiket` MODIFY COLUMN `public_token` VARCHAR(40) NOT NULL;
