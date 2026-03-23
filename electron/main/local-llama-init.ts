import { listProviderAccounts, saveProviderAccount, setDefaultProviderAccount, getProviderAccount } from '../services/providers/provider-store';
import type { ProviderAccount } from '../shared/providers/types';
import { providerAccountToConfig } from '../services/providers/provider-store';
import { syncSavedProviderToRuntime } from '../services/providers/provider-runtime-sync';
import { GatewayManager } from '../gateway/manager';

const LOCAL_LLAMA_ACCOUNT_ID = 'local-llama-default';

let gatewayManagerInstance: GatewayManager | null = null;

export function setGatewayManager(gm: GatewayManager) {
  gatewayManagerInstance = gm;
}

export async function ensureLocalLlamaProvider(): Promise<void> {
  try {
    console.log('========================================');
    console.log('[LocalLlama] Starting ensureLocalLlamaProvider...');
    console.log('========================================');
    
    const accounts = await listProviderAccounts();
    console.log('[LocalLlama] Found accounts:', accounts.length);
    
    const existingAccount = accounts.find((a) => a.vendorId === 'local-llama');

    console.log('[LocalLlama] Existing account:', existingAccount);

    if (existingAccount) {
      console.log('[LocalLlama] Provider already exists:', existingAccount.id);
      await setDefaultProviderAccount(LOCAL_LLAMA_ACCOUNT_ID);
      console.log('[LocalLlama] Provider already configured, keeping existing model:', existingAccount.model);
      return;
    }

    console.log('[LocalLlama] Creating default local-llama provider...');

    const now = new Date().toISOString();
    const newAccount: ProviderAccount = {
      id: LOCAL_LLAMA_ACCOUNT_ID,
      vendorId: 'local-llama',
      label: '本地推理',
      authMode: 'local',
      baseUrl: 'http://localhost:18432/v1',
      model: 'qwen3.5-35b-a3b',
      enabled: true,
      isDefault: true,
      createdAt: now,
      updatedAt: now,
    };

    await saveProviderAccount(newAccount);
    await setDefaultProviderAccount(LOCAL_LLAMA_ACCOUNT_ID);

    console.log('[LocalLlama] Provider saved, syncing to runtime...');

    const config = providerAccountToConfig(newAccount);
    await syncSavedProviderToRuntime(config, undefined, gatewayManagerInstance ?? undefined);

    console.log('[LocalLlama] Provider created and synced:', LOCAL_LLAMA_ACCOUNT_ID);
  } catch (error) {
    console.error('[LocalLlama] Error:', error);
  }
}
