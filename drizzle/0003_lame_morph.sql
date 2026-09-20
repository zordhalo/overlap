CREATE TABLE "recovery_attempt" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subject" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "member" ADD COLUMN "email_encrypted" text;--> statement-breakpoint
ALTER TABLE "member" ADD COLUMN "email_hash" text;--> statement-breakpoint
CREATE INDEX "recovery_attempt_subject_idx" ON "recovery_attempt" USING btree ("subject","created_at");--> statement-breakpoint
CREATE INDEX "member_email_hash_idx" ON "member" USING btree ("email_hash");