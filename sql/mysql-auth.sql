-- Executado automaticamente pela aplicação ao conectar com permissão CREATE.
-- Alternativa: executar manualmente no Workbench, no banco nextech_leads.
USE `nextech_leads`;
CREATE TABLE IF NOT EXISTS `AppUser` (
  `id` VARCHAR(255) COLLATE utf8mb4_bin NOT NULL PRIMARY KEY,
  `data` JSON NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS `AppSession` LIKE `AppUser`;
CREATE TABLE IF NOT EXISTS `AppMeta` LIKE `AppUser`;
CREATE TABLE IF NOT EXISTS `AppMutex` (
  `id` INT NOT NULL PRIMARY KEY
) ENGINE=InnoDB;
INSERT IGNORE INTO `AppMutex` (`id`) VALUES (1);
