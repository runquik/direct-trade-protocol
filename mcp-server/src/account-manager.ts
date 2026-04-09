/**
 * Multi-identity account manager for the DTP MCP server.
 *
 * Manages multiple NEAR testnet accounts (buyer, seller, etc.)
 * with a "current identity" concept for signing transactions.
 * Persists account data to .near-credentials/accounts.json.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { addKey } from "./near-client.js";

const CREDENTIALS_DIR = join(process.cwd(), ".near-credentials");
const ACCOUNTS_FILE = join(CREDENTIALS_DIR, "accounts.json");

export interface IdentityRecord {
  label: string;
  businessType: string;
  privateKey: string;
}

export interface AccountsData {
  masterAccount: string;
  contractId: string;
  currentIdentity: string;
  identities: Record<string, IdentityRecord>;
}

let accountsData: AccountsData | null = null;

function ensureDir(): void {
  if (!existsSync(CREDENTIALS_DIR)) {
    mkdirSync(CREDENTIALS_DIR, { recursive: true });
  }
}

export function loadAccounts(): AccountsData {
  // Always read from disk to pick up external changes
  if (existsSync(ACCOUNTS_FILE)) {
    const raw = readFileSync(ACCOUNTS_FILE, "utf-8");
    accountsData = JSON.parse(raw) as AccountsData;
  } else {
    // Default — will be populated by init or create_account
    accountsData = {
      masterAccount: process.env.DTP_MASTER_ACCOUNT || "",
      contractId: process.env.DTP_CONTRACT_ID || "",
      currentIdentity: "",
      identities: {},
    };
  }

  return accountsData;
}

export function saveAccounts(): void {
  ensureDir();
  if (!accountsData) return;
  writeFileSync(ACCOUNTS_FILE, JSON.stringify(accountsData, null, 2), "utf-8");
}

/**
 * Initialize the account manager with master account and contract info.
 */
export function initAccounts(masterAccount: string, contractId: string, masterPrivateKey: string): void {
  const data = loadAccounts();
  data.masterAccount = masterAccount;
  data.contractId = contractId;

  // Store master as an identity too
  data.identities[masterAccount] = {
    label: "Protocol Owner",
    businessType: "Agent",
    privateKey: masterPrivateKey,
  };
  data.currentIdentity = masterAccount;
  saveAccounts();
}

/**
 * Register all stored identity keys with the NEAR key store.
 * Call this at server startup.
 */
export async function loadKeysIntoKeyStore(): Promise<void> {
  const data = loadAccounts();
  for (const [accountId, identity] of Object.entries(data.identities)) {
    if (identity.privateKey) {
      await addKey(accountId, identity.privateKey);
    }
  }
}

/**
 * Add a new identity (e.g., after creating a sub-account).
 */
export function addIdentity(
  accountId: string,
  label: string,
  businessType: string,
  privateKey: string
): void {
  const data = loadAccounts();
  data.identities[accountId] = { label, businessType, privateKey };
  saveAccounts();
}

/**
 * Switch the current signing identity.
 */
export function switchIdentity(accountId: string): void {
  const data = loadAccounts();
  if (!data.identities[accountId]) {
    throw new Error(`Unknown identity: ${accountId}. Use dtp_list_identities to see available accounts.`);
  }
  data.currentIdentity = accountId;
  saveAccounts();
}

/**
 * Get the current identity's account ID.
 */
export function getCurrentIdentity(): string {
  const data = loadAccounts();
  if (!data.currentIdentity) {
    throw new Error("No current identity set. Use dtp_create_account or dtp_switch_identity first.");
  }
  return data.currentIdentity;
}

/**
 * Get the contract ID.
 */
export function getContractId(): string {
  const data = loadAccounts();
  if (!data.contractId) {
    throw new Error("Contract ID not set. Initialize with dtp_init or set DTP_CONTRACT_ID env var.");
  }
  return data.contractId;
}

/**
 * Get the master account ID.
 */
export function getMasterAccount(): string {
  const data = loadAccounts();
  return data.masterAccount;
}

/**
 * List all identities.
 */
export function listIdentities(): { accountId: string; label: string; businessType: string; isCurrent: boolean }[] {
  const data = loadAccounts();
  return Object.entries(data.identities).map(([accountId, identity]) => ({
    accountId,
    label: identity.label,
    businessType: identity.businessType,
    isCurrent: accountId === data.currentIdentity,
  }));
}
