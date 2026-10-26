CREATE TABLE `answers` (
	`room` text NOT NULL,
	`player` text NOT NULL,
	`round` integer NOT NULL,
	`choice` integer,
	`text` text DEFAULT '' NOT NULL,
	`ref` text DEFAULT '' NOT NULL,
	`blocked` integer DEFAULT 0 NOT NULL,
	`confidence` integer DEFAULT 2 NOT NULL,
	`updated` integer NOT NULL,
	`submitted` integer,
	`score` integer,
	`feedback` text DEFAULT '' NOT NULL,
	PRIMARY KEY(`room`, `player`, `round`),
	FOREIGN KEY (`room`) REFERENCES `rooms`(`code`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`player`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`room` text NOT NULL,
	`actor` text NOT NULL,
	`action` text NOT NULL,
	`round` integer NOT NULL,
	`at` integer NOT NULL,
	FOREIGN KEY (`room`) REFERENCES `rooms`(`code`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `limits` (
	`key` text PRIMARY KEY NOT NULL,
	`count` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `players` (
	`id` text PRIMARY KEY NOT NULL,
	`room` text NOT NULL,
	`name` text NOT NULL,
	`token_hash` text NOT NULL,
	`joined` integer NOT NULL,
	`seen` integer NOT NULL,
	FOREIGN KEY (`room`) REFERENCES `rooms`(`code`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `unique_player_name` ON `players` (`room`,`name`);--> statement-breakpoint
CREATE TABLE `rooms` (
	`code` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`host_hash` text NOT NULL,
	`deck` text NOT NULL,
	`current` integer DEFAULT -1 NOT NULL,
	`phase` text DEFAULT 'lobby' NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`mutation` text DEFAULT '' NOT NULL,
	`context` text DEFAULT '' NOT NULL,
	`join_locked` integer DEFAULT 0 NOT NULL,
	`created` integer NOT NULL,
	`ended` integer
);
--> statement-breakpoint
CREATE TABLE `rounds` (
	`room` text NOT NULL,
	`idx` integer NOT NULL,
	`opened` integer NOT NULL,
	`deadline` integer,
	`closed` integer,
	`revealed` integer,
	`team_ref` text DEFAULT '' NOT NULL,
	`team_done` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`room`, `idx`),
	FOREIGN KEY (`room`) REFERENCES `rooms`(`code`) ON UPDATE no action ON DELETE no action
);
