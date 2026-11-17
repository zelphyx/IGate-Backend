-- QRIS voucher: string EMV (qr_content) bisa 300+ karakter → TEXT; qr_url VARCHAR(500).
-- Voucher ikut jalur QRIS charge yang sama dengan tiket (frontend menggambar QRIS asli).
ALTER TABLE `voucher` ADD COLUMN `qr_content` TEXT NULL;
ALTER TABLE `voucher` ADD COLUMN `qr_url` VARCHAR(500) NULL;
