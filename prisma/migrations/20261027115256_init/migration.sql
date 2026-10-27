-- CreateTable
CREATE TABLE `admin` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `nama` VARCHAR(100) NOT NULL,
    `email` VARCHAR(150) NOT NULL,
    `password_hash` VARCHAR(255) NOT NULL,
    `role` VARCHAR(30) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `admin_email_key`(`email`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `tiket` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `nama` VARCHAR(100) NOT NULL,
    `nim` VARCHAR(30) NOT NULL,
    `angkatan` INTEGER NOT NULL,
    `nomor_hp` VARCHAR(20) NOT NULL,
    `email` VARCHAR(150) NOT NULL,
    `harga_tiket` DECIMAL(12, 2) NOT NULL,
    `kode_voucher` VARCHAR(40) NULL,
    `diskon` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `total_bayar` DECIMAL(12, 2) NOT NULL,
    `status_pembayaran` VARCHAR(20) NOT NULL,
    `doku_invoice_id` VARCHAR(100) NULL,
    `qr_token` VARCHAR(100) NULL,
    `status_tiket` VARCHAR(20) NOT NULL,
    `checked_in_at` DATETIME(3) NULL,
    `checked_in_by` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `paid_at` DATETIME(3) NULL,

    UNIQUE INDEX `tiket_doku_invoice_id_key`(`doku_invoice_id`),
    UNIQUE INDEX `tiket_qr_token_key`(`qr_token`),
    INDEX `tiket_nim_idx`(`nim`),
    INDEX `tiket_status_pembayaran_idx`(`status_pembayaran`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `voucher` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `kode_voucher` VARCHAR(40) NOT NULL,
    `nama_pemberi` VARCHAR(100) NOT NULL,
    `nim` VARCHAR(30) NOT NULL,
    `nomor_hp` VARCHAR(20) NOT NULL,
    `nilai_voucher` DECIMAL(12, 2) NOT NULL,
    `status` VARCHAR(20) NOT NULL,
    `dibuat_oleh` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `expired_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `voucher_kode_voucher_key`(`kode_voucher`),
    INDEX `voucher_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `rekap` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `admin_id` INTEGER NULL,
    `tiket_id` INTEGER NULL,
    `voucher_id` INTEGER NULL,
    `jenis_transaksi` VARCHAR(30) NOT NULL,
    `nominal` DECIMAL(12, 2) NOT NULL,
    `metode_pembayaran` VARCHAR(30) NOT NULL,
    `status` VARCHAR(20) NOT NULL,
    `keterangan` TEXT NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `rekap_created_at_idx`(`created_at`),
    INDEX `rekap_jenis_transaksi_idx`(`jenis_transaksi`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `tiket` ADD CONSTRAINT `tiket_checked_in_by_fkey` FOREIGN KEY (`checked_in_by`) REFERENCES `admin`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `voucher` ADD CONSTRAINT `voucher_dibuat_oleh_fkey` FOREIGN KEY (`dibuat_oleh`) REFERENCES `admin`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rekap` ADD CONSTRAINT `rekap_admin_id_fkey` FOREIGN KEY (`admin_id`) REFERENCES `admin`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rekap` ADD CONSTRAINT `rekap_tiket_id_fkey` FOREIGN KEY (`tiket_id`) REFERENCES `tiket`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rekap` ADD CONSTRAINT `rekap_voucher_id_fkey` FOREIGN KEY (`voucher_id`) REFERENCES `voucher`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
