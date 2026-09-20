CREATE TABLE "busy" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"member_id" uuid NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"source" text NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "busy_interval_order" CHECK ("busy"."ends_at" > "busy"."starts_at")
);
--> statement-breakpoint
CREATE TABLE "circle" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"duration_minutes" integer NOT NULL,
	"horizon_days" integer NOT NULL,
	CONSTRAINT "circle_duration_positive" CHECK ("circle"."duration_minutes" > 0 AND "circle"."duration_minutes" <= 1440),
	CONSTRAINT "circle_horizon_positive" CHECK ("circle"."horizon_days" > 0 AND "circle"."horizon_days" <= 365)
);
--> statement-breakpoint
CREATE TABLE "member" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"circle_id" uuid NOT NULL,
	"name" text NOT NULL,
	"timezone" text NOT NULL,
	"sleep_start" integer NOT NULL,
	"sleep_end" integer NOT NULL,
	"work_start" integer NOT NULL,
	"work_end" integer NOT NULL,
	"ics_url_encrypted" text,
	"tag" text NOT NULL,
	"color" text NOT NULL,
	"lat" double precision,
	"lng" double precision,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "member_sleep_start_range" CHECK ("member"."sleep_start" >= 0 AND "member"."sleep_start" <= 1439),
	CONSTRAINT "member_sleep_end_range" CHECK ("member"."sleep_end" >= 0 AND "member"."sleep_end" <= 1439),
	CONSTRAINT "member_work_start_range" CHECK ("member"."work_start" >= 0 AND "member"."work_start" <= 1439),
	CONSTRAINT "member_work_end_range" CHECK ("member"."work_end" >= 0 AND "member"."work_end" <= 1439)
);
--> statement-breakpoint
ALTER TABLE "busy" ADD CONSTRAINT "busy_member_id_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."member"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member" ADD CONSTRAINT "member_circle_id_circle_id_fk" FOREIGN KEY ("circle_id") REFERENCES "public"."circle"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "circle_slug_idx" ON "circle" USING btree ("slug");