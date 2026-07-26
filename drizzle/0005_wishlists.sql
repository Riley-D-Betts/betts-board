CREATE TABLE `wishlist_items` (
	`id` text PRIMARY KEY NOT NULL,
	`wishlist_id` text NOT NULL,
	`name` text NOT NULL,
	`url` text,
	`notes` text,
	`price` text,
	`priority` integer DEFAULT 0 NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_by_profile_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`wishlist_id`) REFERENCES `wishlists`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by_profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `wishlists` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`profile_id` text NOT NULL,
	`title` text NOT NULL,
	`occasion` text,
	`event_date` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`archived_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE cascade
);
