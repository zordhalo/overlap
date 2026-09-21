ALTER TABLE "circle" ADD COLUMN "invite_event_id" text;--> statement-breakpoint
ALTER TABLE "circle" ADD COLUMN "invite_organizer_id" uuid;--> statement-breakpoint
ALTER TABLE "circle" ADD COLUMN "invite_start" bigint;--> statement-breakpoint
ALTER TABLE "circle" ADD COLUMN "invite_end" bigint;--> statement-breakpoint
ALTER TABLE "member" ADD COLUMN "invites_opt_in" boolean DEFAULT false NOT NULL;