-- Reference transaksi Tripay untuk voucher (pola A-1, penamaan legacy dibiarkan)
ALTER TABLE `voucher` ADD COLUMN `doku_invoice_id` VARCHAR(100) NULL;

-- CreateIndex
CREATE UNIQUE INDEX `voucher_doku_invoice_id_key` ON `voucher`(`doku_invoice_id`);
