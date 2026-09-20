ALTER TABLE "circle" ADD COLUMN "chosen_start" bigint;--> statement-breakpoint
ALTER TABLE "circle" ADD COLUMN "chosen_end" bigint;--> statement-breakpoint
ALTER TABLE "circle" ADD COLUMN "chosen_by" uuid;--> statement-breakpoint
ALTER TABLE "circle" ADD COLUMN "chosen_at" timestamp with time zone;