-- NexTech Leads: esquema MySQL 8.4 correspondente ao modelo atual da aplicação.
-- Os atributos de cada entidade são armazenados na coluna JSON data.
-- Este script cria tabelas vazias; não migra o SQLite nem conecta a aplicação.
-- Não apaga nem substitui tabelas existentes.
USE `nextech_leads`;

CREATE TABLE IF NOT EXISTS `Country` (
  `id` VARCHAR(255) COLLATE utf8mb4_bin NOT NULL,
  `data` JSON NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `Region` LIKE `Country`;
CREATE TABLE IF NOT EXISTS `City` LIKE `Country`;
CREATE TABLE IF NOT EXISTS `LeadProvider` LIKE `Country`;
CREATE TABLE IF NOT EXISTS `ProviderCredential` LIKE `Country`;
CREATE TABLE IF NOT EXISTS `Campaign` LIKE `Country`;
CREATE TABLE IF NOT EXISTS `CampaignLocation` LIKE `Country`;
CREATE TABLE IF NOT EXISTS `ScheduledCampaign` LIKE `Country`;
CREATE TABLE IF NOT EXISTS `CapturedLead` LIKE `Country`;
CREATE TABLE IF NOT EXISTS `WebsiteAnalysis` LIKE `Country`;
CREATE TABLE IF NOT EXISTS `QualificationResult` LIKE `Country`;
CREATE TABLE IF NOT EXISTS `ApprovalQueue` LIKE `Country`;
CREATE TABLE IF NOT EXISTS `Pipeline` LIKE `Country`;
CREATE TABLE IF NOT EXISTS `ProviderUsage` LIKE `Country`;
CREATE TABLE IF NOT EXISTS `CollectionEvidence` LIKE `Country`;

CREATE TABLE IF NOT EXISTS `CampaignRun` (
  `id` VARCHAR(255) COLLATE utf8mb4_bin NOT NULL,
  `campaignId` VARCHAR(255) COLLATE utf8mb4_bin NOT NULL,
  `status` VARCHAR(64) NOT NULL,
  `control` VARCHAR(32) NOT NULL DEFAULT 'running',
  `data` JSON NOT NULL,
  -- Substitui a ordenação por rowid usada no SQLite.
  `runSequence` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  PRIMARY KEY (`id`),
  UNIQUE KEY `run_sequence` (`runSequence`),
  KEY `run_campaign` (`campaignId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `LeadIdentity` (
  `identity` CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `leadId` VARCHAR(255) COLLATE utf8mb4_bin NOT NULL,
  PRIMARY KEY (`identity`),
  KEY `identity_lead` (`leadId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `Suppression` (
  `identity` CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  -- Mantém o formato ISO 8601 UTC usado pela aplicação.
  `createdAt` VARCHAR(32) CHARACTER SET ascii NOT NULL,
  PRIMARY KEY (`identity`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SHOW TABLES;
