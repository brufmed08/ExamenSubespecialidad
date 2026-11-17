import { pgTable, text, jsonb, timestamp, primaryKey } from "drizzle-orm/pg-core";

/* Almacén documental: cada colección del núcleo (users, sessions, attempts, consents,
   incidents, notifications, settings, resets, audit, cfg…) se guarda como filas JSON. */
export const records = pgTable(
  "records",
  {
    collection: text("collection").notNull(),
    id: text("id").notNull(),
    data: jsonb("data").notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [primaryKey({ columns: [t.collection, t.id] })]
);
