CREATE TABLE "records" (
	"collection" text,
	"id" text,
	"data" jsonb NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "records_pkey" PRIMARY KEY("collection","id")
);
