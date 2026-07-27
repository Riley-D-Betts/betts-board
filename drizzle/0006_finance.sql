CREATE TABLE `finance_accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`connection_id` text,
	`external_id` text,
	`org_name` text,
	`name` text NOT NULL,
	`type` text DEFAULT 'checking' NOT NULL,
	`currency` text DEFAULT 'USD' NOT NULL,
	`currency_exponent` integer DEFAULT 2 NOT NULL,
	`balance_source` text DEFAULT 'ledger' NOT NULL,
	`balance_minor` integer DEFAULT 0 NOT NULL,
	`available_balance_minor` integer,
	`balance_at` integer,
	`is_hidden` integer DEFAULT false NOT NULL,
	`include_in_net_worth` integer DEFAULT true NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`archived_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`connection_id`) REFERENCES `finance_connections`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `finance_accounts_external_unique` ON `finance_accounts` (`connection_id`,`external_id`);--> statement-breakpoint
CREATE INDEX `finance_accounts_household_idx` ON `finance_accounts` (`household_id`);--> statement-breakpoint
CREATE TABLE `finance_bill_payments` (
	`id` text PRIMARY KEY NOT NULL,
	`bill_id` text NOT NULL,
	`due_date` text NOT NULL,
	`status` text NOT NULL,
	`paid_at` integer,
	`amount_minor` integer,
	`transaction_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`bill_id`) REFERENCES `finance_bills`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`transaction_id`) REFERENCES `finance_transactions`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `finance_bill_payments_unique` ON `finance_bill_payments` (`bill_id`,`due_date`);--> statement-breakpoint
CREATE TABLE `finance_bills` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`name` text NOT NULL,
	`kind` text DEFAULT 'expense' NOT NULL,
	`category_id` text,
	`amount_minor` integer NOT NULL,
	`currency` text DEFAULT 'USD' NOT NULL,
	`rrule` text,
	`start_date` text NOT NULL,
	`recurrence_end` text,
	`account_id` text,
	`auto_pay` integer DEFAULT false NOT NULL,
	`notes` text,
	`archived_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`category_id`) REFERENCES `finance_categories`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`account_id`) REFERENCES `finance_accounts`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `finance_bills_household_idx` ON `finance_bills` (`household_id`);--> statement-breakpoint
CREATE TABLE `finance_budgets` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`category_id` text NOT NULL,
	`period_start` text NOT NULL,
	`amount_minor` integer NOT NULL,
	`currency` text DEFAULT 'USD' NOT NULL,
	`rollover` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`category_id`) REFERENCES `finance_categories`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `finance_budgets_unique` ON `finance_budgets` (`household_id`,`category_id`,`period_start`);--> statement-breakpoint
CREATE TABLE `finance_categories` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`name` text NOT NULL,
	`kind` text DEFAULT 'expense' NOT NULL,
	`icon` text,
	`color` text,
	`parent_id` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`is_system` integer DEFAULT false NOT NULL,
	`archived_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `finance_categories_household_idx` ON `finance_categories` (`household_id`);--> statement-breakpoint
CREATE TABLE `finance_connections` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`provider` text DEFAULT 'simplefin' NOT NULL,
	`nickname` text,
	`access_url_enc` text NOT NULL,
	`status` text DEFAULT 'ok' NOT NULL,
	`sync_interval_minutes` integer DEFAULT 360 NOT NULL,
	`last_attempt_at` integer,
	`last_sync_at` integer,
	`next_attempt_at` integer,
	`consecutive_failures` integer DEFAULT 0 NOT NULL,
	`last_error` text,
	`last_error_list` text,
	`created_by_profile_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by_profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `finance_connections_next_attempt_idx` ON `finance_connections` (`next_attempt_at`);--> statement-breakpoint
CREATE TABLE `finance_goal_contributions` (
	`id` text PRIMARY KEY NOT NULL,
	`goal_id` text NOT NULL,
	`amount_minor` integer NOT NULL,
	`contributed_on` text NOT NULL,
	`note` text,
	`created_by_profile_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`goal_id`) REFERENCES `finance_goals`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by_profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `finance_goal_contributions_goal_idx` ON `finance_goal_contributions` (`goal_id`);--> statement-breakpoint
CREATE TABLE `finance_goals` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`name` text NOT NULL,
	`target_minor` integer NOT NULL,
	`currency` text DEFAULT 'USD' NOT NULL,
	`target_date` text,
	`account_id` text,
	`icon` text,
	`color` text,
	`archived_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`account_id`) REFERENCES `finance_accounts`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `finance_goals_household_idx` ON `finance_goals` (`household_id`);--> statement-breakpoint
CREATE TABLE `finance_import_batches` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`account_id` text NOT NULL,
	`filename` text NOT NULL,
	`format` text NOT NULL,
	`column_map` text,
	`row_count` integer DEFAULT 0 NOT NULL,
	`imported_count` integer DEFAULT 0 NOT NULL,
	`skipped_count` integer DEFAULT 0 NOT NULL,
	`reverted_at` integer,
	`created_by_profile_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`account_id`) REFERENCES `finance_accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by_profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `finance_import_batches_account_idx` ON `finance_import_batches` (`account_id`);--> statement-breakpoint
CREATE TABLE `finance_members` (
	`profile_id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`role` text DEFAULT 'member' NOT NULL,
	`failed_attempts` integer DEFAULT 0 NOT NULL,
	`locked_until` integer,
	`failed_since_last_unlock` integer DEFAULT 0 NOT NULL,
	`last_unlock_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `finance_rules` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`priority` integer DEFAULT 0 NOT NULL,
	`match_field` text DEFAULT 'description' NOT NULL,
	`match_type` text DEFAULT 'contains' NOT NULL,
	`match_value` text NOT NULL,
	`account_id` text,
	`set_category_id` text,
	`set_payee` text,
	`enabled` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`account_id`) REFERENCES `finance_accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`set_category_id`) REFERENCES `finance_categories`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `finance_rules_household_idx` ON `finance_rules` (`household_id`,`priority`);--> statement-breakpoint
CREATE TABLE `finance_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`profile_id` text NOT NULL,
	`nonce_hash` text NOT NULL,
	`started_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL,
	`device_label` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `finance_sessions_nonce_unique` ON `finance_sessions` (`nonce_hash`);--> statement-breakpoint
CREATE INDEX `finance_sessions_profile_idx` ON `finance_sessions` (`profile_id`);--> statement-breakpoint
CREATE TABLE `finance_transactions` (
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
	`category_id` text,
	`categorized_by` text,
	`notes` text,
	`source` text DEFAULT 'manual' NOT NULL,
	`import_batch_id` text,
	`dedupe_hash` text,
	`created_by_profile_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`account_id`) REFERENCES `finance_accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`category_id`) REFERENCES `finance_categories`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`import_batch_id`) REFERENCES `finance_import_batches`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by_profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `finance_txn_external_unique` ON `finance_transactions` (`account_id`,`external_id`);--> statement-breakpoint
CREATE INDEX `finance_txn_account_posted_idx` ON `finance_transactions` (`account_id`,`posted_date`);--> statement-breakpoint
CREATE INDEX `finance_txn_household_posted_idx` ON `finance_transactions` (`household_id`,`posted_date`);--> statement-breakpoint
CREATE INDEX `finance_txn_dedupe_idx` ON `finance_transactions` (`account_id`,`dedupe_hash`);