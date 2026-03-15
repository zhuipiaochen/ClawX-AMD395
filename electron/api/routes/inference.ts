import type { IncomingMessage, ServerResponse } from 'http';
import type { HostApiContext } from '../context';
import { sendJson, parseBody } from '../route-utils';
import { InferenceManager } from '../../inference';
import { providerService } from '../../services/providers/provider-service';
import { syncSavedProviderToRuntime, syncDefaultProviderToRuntime } from '../../services/providers/provider-runtime-sync';

const inferenceManager = InferenceManager.getInstance();

export async function handleInferenceRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  _ctx: HostApiContext,
): Promise<boolean> {
  const pathname = url.pathname;

  if (pathname === '/api/inference/initialize' && req.method === 'POST') {
    try {
      await inferenceManager.initialize();
      sendJson(res, 200, { success: true });
    } catch (error) {
      sendJson(res, 500, { success: false, error: (error as Error).message });
    }
    return true;
  }

  if (pathname === '/api/inference/status' && req.method === 'GET') {
    try {
      const status = inferenceManager.getStatus();
      const isAvailable = await inferenceManager.isEngineAvailable();
      sendJson(res, 200, { success: true, data: { ...status, engineAvailable: isAvailable } });
    } catch (error) {
      sendJson(res, 500, { success: false, error: (error as Error).message });
    }
    return true;
  }

  if (pathname === '/api/inference/start' && req.method === 'POST') {
    console.log('===== INFERENCE START CALLED =====');
    try {
      const body = await parseBody(req);
      const modelId = (body as any).modelId || 'Qwen3.5-0.8B-Q4_0';
      console.log('===== MODEL:', modelId, '=====');
      
      await inferenceManager.start(modelId);
      console.log('===== ENGINE STARTED =====');
      
      const accounts = await providerService.listAccounts();
      console.log('===== ACCOUNTS:', JSON.stringify(accounts.map(a => a.vendorId)), '=====');
      const localAccount = accounts.find(a => a.vendorId === 'local-llama');
      
      const modelName = modelId.replace('-Q4_0', '').replace('-Q4_K_M', '').toLowerCase();
      
      if (!localAccount) {
        console.log('[Inference] Creating new local-llama account...');
        const newAccount = await providerService.createAccount({
          vendorId: 'local-llama',
          label: '本地推理',
          authMode: 'local',
          baseUrl: 'http://localhost:8080/v1',
          model: modelName
        });
        console.log('[Inference] Account created:', newAccount.id);
        
        const config = await import('../../services/providers/provider-store').then(m => m.providerAccountToConfig(newAccount));
        console.log('[Inference] Calling syncSavedProviderToRuntime...');
        await syncSavedProviderToRuntime(config, undefined, _ctx.gatewayManager);
        console.log('[Inference] syncSavedProviderToRuntime returned');
      } else {
        console.log('[Inference] Account already exists:', localAccount.id);
        const config = await import('../../services/providers/provider-store').then(m => m.providerAccountToConfig(localAccount));
        console.log('[Inference] Syncing existing account to runtime...');
        await syncSavedProviderToRuntime(config, undefined, _ctx.gatewayManager);
        console.log('[Inference] Synced existing to runtime');
      }
      
      sendJson(res, 200, { success: true });
    } catch (error) {
      console.error('[Inference] Start error:', error);
      sendJson(res, 500, { success: false, error: (error as Error).message });
    }
    return true;
  }

  if (pathname === '/api/inference/stop' && req.method === 'POST') {
    try {
      await inferenceManager.stop();
      sendJson(res, 200, { success: true });
    } catch (error) {
      sendJson(res, 500, { success: false, error: (error as Error).message });
    }
    return true;
  }

  if (pathname === '/api/inference/models/local' && req.method === 'GET') {
    try {
      const localModels = await inferenceManager.getModelManager().getLocalModels();
      sendJson(res, 200, { success: true, data: localModels });
    } catch (error) {
      sendJson(res, 500, { success: false, error: (error as Error).message });
    }
    return true;
  }

  if (pathname === '/api/inference/models/recommended' && req.method === 'GET') {
    try {
      const models = inferenceManager.getModelManager().getRecommendedModels();
      sendJson(res, 200, { success: true, data: models });
    } catch (error) {
      sendJson(res, 500, { success: false, error: (error as Error).message });
    }
    return true;
  }

  const downloadMatch = pathname.match(/^\/api\/inference\/models\/download\/(.+)$/);
  if (downloadMatch && req.method === 'POST') {
    const modelId = downloadMatch[1];
    try {
      const models = inferenceManager.getModelManager().getRecommendedModels();
      const model = models.find(m => m.id === modelId);
      
      if (!model || !model.url) {
        sendJson(res, 404, { success: false, error: 'Model not found' });
        return true;
      }

      console.log('[Inference] Downloading model:', modelId, 'isVlm:', model.isVlm);
      await inferenceManager.getModelManager().downloadModel(modelId, model.url);

      if (model.isVlm && model.mmprojUrl) {
        console.log('[Inference] Downloading mmproj for model:', modelId);
        await inferenceManager.getModelManager().downloadModel(`${modelId}-mmproj`, model.mmprojUrl);
      }

      sendJson(res, 200, { success: true });
    } catch (error) {
      console.error('[Inference] Download error:', error);
      sendJson(res, 500, { success: false, error: (error as Error).message });
    }
    return true;
  }

  const deleteMatch = pathname.match(/^\/api\/inference\/models\/(.+)$/);
  if (deleteMatch && req.method === 'DELETE') {
    const modelId = deleteMatch[1];
    try {
      const mmprojId = `${modelId}-mmproj`;
      await inferenceManager.getModelManager().deleteModel(modelId);
      await inferenceManager.getModelManager().deleteModel(mmprojId);
      sendJson(res, 200, { success: true });
    } catch (error) {
      sendJson(res, 500, { success: false, error: (error as Error).message });
    }
    return true;
  }

  if (pathname === '/api/inference/engine/available' && req.method === 'GET') {
    try {
      const isAvailable = await inferenceManager.isEngineAvailable();
      sendJson(res, 200, { success: true, data: { available: isAvailable } });
    } catch (error) {
      sendJson(res, 500, { success: false, error: (error as Error).message });
    }
    return true;
  }

  const searchMatch = pathname.match(/^\/api\/inference\/models\/search\?q=(.*)$/);
  if (searchMatch && req.method === 'GET') {
    const query = decodeURIComponent(searchMatch[1]);
    console.log('[Inference] Search query:', query);
    try {
      const results = await inferenceManager.getModelManager().searchModels(query);
      sendJson(res, 200, { success: true, data: results });
    } catch (error) {
      console.error('[Inference] Search error:', error);
      sendJson(res, 500, { success: false, error: (error as Error).message });
    }
    return true;
  }

  return false;
}
