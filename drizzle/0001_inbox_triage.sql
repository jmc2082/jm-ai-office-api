CREATE TABLE `mail_messages` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`mailbox_id` integer NOT NULL,
	`provider_message_id` text NOT NULL,
	`run_id` integer,
	`card_id` integer,
	`from_address` text NOT NULL,
	`from_name` text,
	`subject` text DEFAULT '' NOT NULL,
	`snippet` text DEFAULT '' NOT NULL,
	`received_at` integer NOT NULL,
	`verdict` text NOT NULL,
	`topic` text,
	`confidence` real,
	`reason` text DEFAULT '' NOT NULL,
	`decided_by` text NOT NULL,
	`signals` text,
	`link` text,
	`digested_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`mailbox_id`) REFERENCES `mailboxes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`card_id`) REFERENCES `cards`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `mail_messages_mailbox_msg_idx` ON `mail_messages` (`mailbox_id`,`provider_message_id`);--> statement-breakpoint
CREATE INDEX `mail_messages_verdict_idx` ON `mail_messages` (`verdict`);--> statement-breakpoint
CREATE INDEX `mail_messages_created_idx` ON `mail_messages` (`created_at`);--> statement-breakpoint
CREATE TABLE `mailboxes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`provider` text NOT NULL,
	`address` text NOT NULL,
	`label` text,
	`refresh_token_enc` text NOT NULL,
	`cursor` text,
	`status` text DEFAULT 'active' NOT NULL,
	`last_synced_at` integer,
	`last_error` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `mailboxes_provider_address_idx` ON `mailboxes` (`provider`,`address`);