CREATE TABLE `households` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`password_hash` text NOT NULL,
	`timezone` text DEFAULT 'UTC' NOT NULL,
	`latitude` real,
	`longitude` real,
	`location_name` text,
	`ics_token` text NOT NULL,
	`vapid_public_key` text,
	`vapid_private_key` text,
	`settings` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`name` text NOT NULL,
	`color` text NOT NULL,
	`avatar_path` text,
	`role` text DEFAULT 'adult' NOT NULL,
	`pin_hash` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`archived_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `calendar_feeds` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`name` text NOT NULL,
	`url` text NOT NULL,
	`color` text DEFAULT '#64748b' NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`fetch_interval_minutes` integer DEFAULT 60 NOT NULL,
	`last_fetched_at` integer,
	`last_status` text,
	`last_error` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `event_attendees` (
	`event_id` text NOT NULL,
	`profile_id` text NOT NULL,
	PRIMARY KEY(`event_id`, `profile_id`),
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `event_exceptions` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`occurrence_start` integer NOT NULL,
	`kind` text NOT NULL,
	`new_start_at` integer,
	`new_end_at` integer,
	`new_title` text,
	`new_location` text,
	`new_description` text,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `event_exceptions_unique` ON `event_exceptions` (`event_id`,`occurrence_start`);--> statement-breakpoint
CREATE TABLE `events` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`location` text,
	`is_all_day` integer DEFAULT false NOT NULL,
	`start_at` integer,
	`end_at` integer,
	`start_date` text,
	`end_date` text,
	`timezone` text NOT NULL,
	`rrule` text,
	`recurrence_end` integer,
	`reminder_minutes` text,
	`color` text,
	`feed_id` text,
	`external_uid` text,
	`created_by_profile_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`feed_id`) REFERENCES `calendar_feeds`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by_profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `events_feed_uid_unique` ON `events` (`feed_id`,`external_uid`);--> statement-breakpoint
CREATE INDEX `events_household_start_idx` ON `events` (`household_id`,`start_at`);--> statement-breakpoint
CREATE INDEX `events_household_rrule_idx` ON `events` (`household_id`,`rrule`);--> statement-breakpoint
CREATE TABLE `chore_assignees` (
	`chore_id` text NOT NULL,
	`profile_id` text NOT NULL,
	PRIMARY KEY(`chore_id`, `profile_id`),
	FOREIGN KEY (`chore_id`) REFERENCES `chores`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `chore_completions` (
	`id` text PRIMARY KEY NOT NULL,
	`chore_id` text NOT NULL,
	`profile_id` text NOT NULL,
	`due_date` text NOT NULL,
	`completed_at` integer NOT NULL,
	`points_awarded` integer NOT NULL,
	FOREIGN KEY (`chore_id`) REFERENCES `chores`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `chore_completions_unique` ON `chore_completions` (`chore_id`,`profile_id`,`due_date`);--> statement-breakpoint
CREATE TABLE `chore_exceptions` (
	`chore_id` text NOT NULL,
	`due_date` text NOT NULL,
	PRIMARY KEY(`chore_id`, `due_date`),
	FOREIGN KEY (`chore_id`) REFERENCES `chores`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `chores` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`emoji` text,
	`points` integer DEFAULT 1 NOT NULL,
	`rrule` text,
	`start_date` text NOT NULL,
	`due_time` text,
	`recurrence_end` text,
	`archived_at` integer,
	`created_by_profile_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by_profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `recipe_ingredients` (
	`id` text PRIMARY KEY NOT NULL,
	`recipe_id` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`raw` text NOT NULL,
	`quantity` real,
	`unit` text,
	`name` text,
	`note` text,
	FOREIGN KEY (`recipe_id`) REFERENCES `recipes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `recipe_notes` (
	`id` text PRIMARY KEY NOT NULL,
	`recipe_id` text NOT NULL,
	`profile_id` text,
	`body` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`recipe_id`) REFERENCES `recipes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `recipe_ratings` (
	`recipe_id` text NOT NULL,
	`profile_id` text NOT NULL,
	`rating` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`recipe_id`, `profile_id`),
	FOREIGN KEY (`recipe_id`) REFERENCES `recipes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `recipes` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`source_url` text,
	`image_path` text,
	`prep_minutes` integer,
	`cook_minutes` integer,
	`total_minutes` integer,
	`servings` real,
	`steps` text NOT NULL,
	`tags` text,
	`created_by_profile_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by_profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `meal_plan_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`date` text NOT NULL,
	`slot` text NOT NULL,
	`recipe_id` text,
	`free_text` text,
	`servings_override` real,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`recipe_id`) REFERENCES `recipes`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "meal_plan_entry_source" CHECK(("meal_plan_entries"."recipe_id" IS NULL) != ("meal_plan_entries"."free_text" IS NULL))
);
--> statement-breakpoint
CREATE INDEX `meal_plan_household_date_idx` ON `meal_plan_entries` (`household_id`,`date`);--> statement-breakpoint
CREATE TABLE `shopping_list_items` (
	`id` text PRIMARY KEY NOT NULL,
	`list_id` text NOT NULL,
	`name` text NOT NULL,
	`display_quantity` text,
	`quantity` real,
	`unit` text,
	`category` text,
	`checked` integer DEFAULT false NOT NULL,
	`checked_at` integer,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`source_recipe_ids` text,
	`created_by_profile_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`list_id`) REFERENCES `shopping_lists`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by_profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `shopping_lists` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`name` text NOT NULL,
	`is_default` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `barcode_cache` (
	`barcode` text PRIMARY KEY NOT NULL,
	`product_name` text NOT NULL,
	`brand` text,
	`image_url` text,
	`source` text NOT NULL,
	`fetched_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `pantry_items` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`name` text NOT NULL,
	`name_key` text NOT NULL,
	`quantity` real,
	`unit` text,
	`category` text,
	`barcode` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `pantry_household_key_idx` ON `pantry_items` (`household_id`,`name_key`);--> statement-breakpoint
CREATE TABLE `photos` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`uploaded_by_profile_id` text,
	`path` text NOT NULL,
	`thumb_path` text NOT NULL,
	`width` integer NOT NULL,
	`height` integer NOT NULL,
	`size_bytes` integer NOT NULL,
	`taken_at` integer,
	`in_slideshow` integer DEFAULT true NOT NULL,
	`uploaded_at` integer NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`uploaded_by_profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `notification_log` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`ref_id` text NOT NULL,
	`occurrence_key` text NOT NULL,
	`subscription_id` text NOT NULL,
	`sent_at` integer NOT NULL,
	FOREIGN KEY (`subscription_id`) REFERENCES `push_subscriptions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `notification_log_unique` ON `notification_log` (`kind`,`ref_id`,`occurrence_key`,`subscription_id`);--> statement-breakpoint
CREATE TABLE `push_subscriptions` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`profile_id` text,
	`endpoint` text NOT NULL,
	`p256dh` text NOT NULL,
	`auth` text NOT NULL,
	`user_agent` text,
	`fail_count` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `push_subscriptions_endpoint_unique` ON `push_subscriptions` (`endpoint`);