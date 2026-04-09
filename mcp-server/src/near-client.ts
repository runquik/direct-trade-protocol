/**
 * NEAR RPC client abstraction.
 * Wraps near-api-js to provide simple call() and view() methods
 * for interacting with the DTP contract on testnet.
 */

import { connect, keyStores, KeyPair, Near, Account } from "near-api-js";

const DEFAULT_GAS = "100000000000000"; // 100 TGas
const ZERO_DEPOSIT = "0";

let nearConnection: Near | null = null;
let keyStore: keyStores.InMemoryKeyStore | null = null;

export function getKeyStore(): keyStores.InMemoryKeyStore {
  if (!keyStore) {
    keyStore = new keyStores.InMemoryKeyStore();
  }
  return keyStore;
}

export async function getNearConnection(): Promise<Near> {
  if (nearConnection) return nearConnection;

  const networkId = process.env.NEAR_NETWORK_ID || "testnet";
  const nodeUrl = process.env.NEAR_NODE_URL || "https://test.rpc.fastnear.com";

  nearConnection = await connect({
    networkId,
    keyStore: getKeyStore(),
    nodeUrl,
  } as any);

  return nearConnection;
}

/**
 * Add a key pair to the in-memory key store for a given account.
 */
export async function addKey(accountId: string, privateKey: string): Promise<void> {
  const ks = getKeyStore();
  const networkId = process.env.NEAR_NETWORK_ID || "testnet";
  const kp = KeyPair.fromString(privateKey);
  await ks.setKey(networkId, accountId, kp);
}

/**
 * Get an Account object for a given account ID.
 * The account's key must already be in the key store.
 */
export async function getAccount(accountId: string): Promise<Account> {
  const near = await getNearConnection();
  return near.account(accountId);
}

/**
 * Call a state-changing method on the DTP contract.
 * Requires the signer's key to be in the key store.
 */
export async function callMethod(params: {
  contractId: string;
  methodName: string;
  args: Record<string, any>;
  signerAccountId: string;
  gas?: string;
  deposit?: string;
}): Promise<any> {
  const account = await getAccount(params.signerAccountId);
  const result: any = await account.functionCall({
    contractId: params.contractId,
    methodName: params.methodName,
    args: params.args,
    gas: BigInt(params.gas ?? DEFAULT_GAS),
    attachedDeposit: BigInt(params.deposit ?? ZERO_DEPOSIT),
  });

  // Extract the return value from the transaction result
  const status = result.status;
  if (typeof status === "object" && "SuccessValue" in status) {
    const encoded = status.SuccessValue;
    if (encoded && encoded.length > 0) {
      const decoded = Buffer.from(encoded, "base64").toString("utf-8");
      try {
        return JSON.parse(decoded);
      } catch {
        // Some methods return plain strings (e.g. IDs)
        return decoded.replace(/^"|"$/g, "");
      }
    }
    return null;
  }

  // Check for failure
  if (typeof status === "object" && "Failure" in status) {
    throw new Error(`Transaction failed: ${JSON.stringify(status.Failure)}`);
  }

  return null;
}

/**
 * Call a read-only view method on the DTP contract.
 * No signing or gas required.
 */
export async function viewMethod(params: {
  contractId: string;
  methodName: string;
  args: Record<string, any>;
}): Promise<any> {
  const near = await getNearConnection();
  const account = await near.account("dontcare");

  const result = await account.viewFunction({
    contractId: params.contractId,
    methodName: params.methodName,
    args: params.args,
  });

  return result;
}

/**
 * Create a sub-account and fund it from the parent account.
 */
export async function createSubAccount(params: {
  parentAccountId: string;
  newAccountId: string;
  initialBalanceNear: string;
}): Promise<{ publicKey: string; privateKey: string }> {
  const parentAccount = await getAccount(params.parentAccountId);
  const newKeyPair = KeyPair.fromRandom("ed25519");

  await parentAccount.createAccount(
    params.newAccountId,
    newKeyPair.getPublicKey(),
    BigInt(params.initialBalanceNear) * BigInt("1000000000000000000000000") // NEAR to yoctoNEAR
  );

  // Add the new key to our key store
  await addKey(params.newAccountId, newKeyPair.toString());

  return {
    publicKey: newKeyPair.getPublicKey().toString(),
    privateKey: newKeyPair.toString(),
  };
}
