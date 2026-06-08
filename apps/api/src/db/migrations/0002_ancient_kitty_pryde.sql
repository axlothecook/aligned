ALTER TABLE "events" ALTER COLUMN "during" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ALTER COLUMN "timezone" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "during_date" daterange;