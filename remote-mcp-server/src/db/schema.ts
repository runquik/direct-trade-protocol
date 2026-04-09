import { pgTable, text, uuid, timestamp, integer, boolean, uniqueIndex } from "drizzle-orm/pg-core";

export const organizations = pgTable("organizations", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  nearAccount: text("near_account").notNull().unique(),
  nearPrivateKey: text("near_private_key").notNull(), // encrypted
  businessType: text("business_type").notNull(),
  jurisdiction: text("jurisdiction").notNull().default("US"),
  // Trade limits (cents, null = unlimited)
  perTradeLimitCents: integer("per_trade_limit_cents"),
  dailyLimitCents: integer("daily_limit_cents"),
  // KYB
  kybStatus: text("kyb_status").notNull().default("none"), // none | docs_uploaded | pending | verified
  kybDocsUrl: text("kyb_docs_url"),
  kybLegalName: text("kyb_legal_name"),
  kybTaxId: text("kyb_tax_id"), // encrypted
  // Timestamps
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  oauthSub: text("oauth_sub").notNull().unique(),
  email: text("email"),
  displayName: text("display_name"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const memberships = pgTable("memberships", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id),
  orgId: uuid("org_id").notNull().references(() => organizations.id),
  role: text("role").notNull().default("member"), // admin | member
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  uniqueIndex("memberships_user_org_idx").on(table.userId, table.orgId),
]);

export const inviteCodes = pgTable("invite_codes", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull().references(() => organizations.id),
  code: text("code").notNull().unique(),
  createdBy: uuid("created_by").notNull().references(() => users.id),
  usedBy: uuid("used_by").references(() => users.id),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const tradeActivity = pgTable("trade_activity", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull().references(() => organizations.id),
  userId: uuid("user_id").notNull().references(() => users.id),
  action: text("action").notNull(),
  amountCents: integer("amount_cents").notNull(),
  nearTxHash: text("near_tx_hash"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const shipments = pgTable("shipments", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull().references(() => organizations.id),
  contractId: text("contract_id").notNull(),
  shippoTransactionId: text("shippo_transaction_id").notNull(),
  trackingNumber: text("tracking_number"),
  trackingUrl: text("tracking_url"),
  labelUrl: text("label_url"),
  carrier: text("carrier").notNull(),
  rateCents: integer("rate_cents").notNull(),
  status: text("status").notNull().default("created"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const oauthClients = pgTable("oauth_clients", {
  clientId: text("client_id").primaryKey(),
  clientInfo: text("client_info").notNull(), // JSON string
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const oauthTokens = pgTable("oauth_tokens", {
  token: text("token").primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id),
  clientId: text("client_id").notNull(),
  scopes: text("scopes").notNull().default(""),
  expiresAt: timestamp("expires_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
