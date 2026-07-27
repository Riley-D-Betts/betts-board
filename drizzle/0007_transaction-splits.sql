CREATE TABLE `finance_transaction_splits` (
	`id` text PRIMARY KEY NOT NULL,
	`transaction_id` text NOT NULL,
	`category_id` text,
	`amount_minor` integer NOT NULL,
	`note` text,
	`categorized_by` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`transaction_id`) REFERENCES `finance_transactions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`category_id`) REFERENCES `finance_categories`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `finance_txn_splits_txn_idx` ON `finance_transaction_splits` (`transaction_id`);--> statement-breakpoint
CREATE INDEX `finance_txn_splits_category_idx` ON `finance_transaction_splits` (`category_id`);--> statement-breakpoint
--
-- HAND-WRITTEN, and it must stay exactly here.
--
-- Every existing transaction becomes one split carrying its whole amount and
-- its category. This has to run BEFORE the table rebuild below, which drops
-- `finance_transactions` (and with it `category_id` / `categorized_by`) and
-- recreates it from `__new_finance_transactions`. After that point the data
-- this reads no longer exists.
--
-- The ids come from SQLite rather than uuidv7(): raw SQL can't call a drizzle
-- column default. IDs are opaque text and this affects only these one-time
-- backfilled rows; everything created afterwards gets a real uuidv7.
--
-- Safe across the rebuild: drizzle turns foreign keys off for it, and the
-- rebuild preserves transaction ids verbatim, so these references still
-- resolve once `__new_finance_transactions` is renamed back into place.
--
INSERT INTO `finance_transaction_splits`
  (`id`, `transaction_id`, `category_id`, `amount_minor`, `note`, `categorized_by`, `sort_order`, `created_at`)
SELECT
  lower(hex(randomblob(16))),
  `id`,
  `category_id`,
  `amount_minor`,
  NULL,
  `categorized_by`,
  0,
  `created_at`
FROM `finance_transactions`;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_finance_transactions` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`account_id` text NOT NULL,
	`external_id` text,
	`posted_at` integer NOT NULL,
	`posted_date` text NOT NULL,
	`amount_minor` integer NOT NULL,
	`currency` text DEFAULT 'USD' NOT NULL,
	`currency_exponent` integer DEFAULT 2 NOT NULL,
	`description` text NOT NULL,
	`payee` text,
	`memo` text,
	`pending` integer DEFAULT false NOT NULL,
	`notes` text,
	`source` text DEFAULT 'manual' NOT NULL,
	`import_batch_id` text,
	`dedupe_hash` text,
	`created_by_profile_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`account_id`) REFERENCES `finance_accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`import_batch_id`) REFERENCES `finance_import_batches`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by_profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_finance_transactions`("id", "household_id", "account_id", "external_id", "posted_at", "posted_date", "amount_minor", "currency", "currency_exponent", "description", "payee", "memo", "pending", "notes", "source", "import_batch_id", "dedupe_hash", "created_by_profile_id", "created_at", "updated_at") SELECT "id", "household_id", "account_id", "external_id", "posted_at", "posted_date", "amount_minor", "currency", "currency_exponent", "description", "payee", "memo", "pending", "notes", "source", "import_batch_id", "dedupe_hash", "created_by_profile_id", "created_at", "updated_at" FROM `finance_transactions`;--> statement-breakpoint
DROP TABLE `finance_transactions`;--> statement-breakpoint
ALTER TABLE `__new_finance_transactions` RENAME TO `finance_transactions`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `finance_txn_external_unique` ON `finance_transactions` (`account_id`,`external_id`);--> statement-breakpoint
CREATE INDEX `finance_txn_account_posted_idx` ON `finance_transactions` (`account_id`,`posted_date`);--> statement-breakpoint
CREATE INDEX `finance_txn_household_posted_idx` ON `finance_transactions` (`household_id`,`posted_date`);--> statement-breakpoint
CREATE INDEX `finance_txn_dedupe_idx` ON `finance_transactions` (`account_id`,`dedupe_hash`);