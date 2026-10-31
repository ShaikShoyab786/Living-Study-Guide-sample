import {
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const onboardingStatusEnum = pgEnum("study_onboarding_status", [
  "not_started",
  "in_progress",
  "completed",
  "skipped",
]);

export const usersTable = pgTable(
  "study_users",
  {
    clerkUserId: text("clerk_user_id").primaryKey(),
    googleProviderId: text("google_provider_id"),
    email: text("email"),
    name: text("name"),
    profileImageUrl: text("profile_image_url"),
    onboardingStatus: onboardingStatusEnum("onboarding_status")
      .notNull()
      .default("not_started"),
    onboardingStep: integer("onboarding_step").notNull().default(1),
    onboardingVersion: integer("onboarding_version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("study_users_google_provider_id_unique")
      .on(table.googleProviderId)
      .where(sql`${table.googleProviderId} is not null`),
  ],
);

export const guestSessionsTable = pgTable("study_guest_sessions", {
  id: uuid("id").defaultRandom().primaryKey(),
  onboardingStatus: onboardingStatusEnum("onboarding_status")
    .notNull()
    .default("not_started"),
  onboardingStep: integer("onboarding_step").notNull().default(1),
  onboardingVersion: integer("onboarding_version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  lastActiveAt: timestamp("last_active_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  transferredToUserId: text("transferred_to_user_id").references(
    () => usersTable.clerkUserId,
    { onDelete: "set null" },
  ),
  transferredAt: timestamp("transferred_at", { withTimezone: true }),
});

export type StudyUser = typeof usersTable.$inferSelect;
export type GuestSession = typeof guestSessionsTable.$inferSelect;
