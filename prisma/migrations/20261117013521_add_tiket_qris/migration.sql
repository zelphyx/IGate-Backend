-- QRIS tiket: string EMV (qr_content) bisa 300+ karakter → TEXT; qr_url VARCHAR(500).
ALTER TABLE `tiket` ADD COLUMN `qr_content` TEXT NULL;
ALTER TABLE `tiket` ADD COLUMN `qr_url` VARCHAR(500) NULL;
