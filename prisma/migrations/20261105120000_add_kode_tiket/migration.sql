-- Kode unik tampilan per tiket (opsi 2): format IGATE-XXXXXX, unik.
-- 1) Tambah kolom nullable dulu
ALTER TABLE `tiket` ADD COLUMN `kode_tiket` VARCHAR(20) NULL;

-- 2) Backfill baris lama dengan kode acak unik
UPDATE `tiket` SET `kode_tiket` = CONCAT(
  'IGATE-',
  UPPER(HEX(6 + FLOOR(RAND() * 3))),
  SUBSTRING(MD5(RAND()), 1, 6)
) WHERE `kode_tiket` IS NULL;

-- 3) Perketat NOT NULL + unique
ALTER TABLE `tiket` MODIFY COLUMN `kode_tiket` VARCHAR(20) NOT NULL;
CREATE UNIQUE INDEX `tiket_kode_tiket_key` ON `tiket`(`kode_tiket`);
