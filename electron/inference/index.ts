import { EventEmitter } from 'events';
import { ModelManager } from './model/manager';
import { EngineManager } from './engine/manager';

export interface InferenceConfig {
  port: number;
  host: string;
  modelId: string;
}

export class InferenceManager extends EventEmitter {
  private static instance: InferenceManager;
  private modelManager: ModelManager;
  private engineManager: EngineManager;
  private config: InferenceConfig;
  private currentModelId: string = '';
  private initialized: boolean = false;

  private constructor() {
    super();
    this.modelManager = new ModelManager();
    this.engineManager = new EngineManager();
    this.config = {
      port: 18432,
      host: 'localhost',
      modelId: ''
    };
  }

  public static getInstance(): InferenceManager {
    if (!InferenceManager.instance) {
      InferenceManager.instance = new InferenceManager();
    }
    return InferenceManager.instance;
  }

  public async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    await this.modelManager.initialize();
    this.initialized = true;
  }

  public async start(modelId: string): Promise<void> {
    const recommendedModels = this.modelManager.getRecommendedModels();
    console.log('[Inference] Recommended models:', recommendedModels.map(m => m.id));
    const modelInfo = recommendedModels.find(m => m.id === modelId);
    console.log('[Inference] Model info for', modelId, ':', modelInfo);

    let modelPath: string;
    let mmprojPath: string | undefined;

    modelPath = await this.modelManager.getModelPath(modelId);

    const isDownloaded = await this.modelManager.isModelDownloaded(modelId);
    if (!isDownloaded) {
      throw new Error('Model not downloaded. Please download it first.');
    }

    if (modelInfo?.isVlm && modelInfo.mmprojUrl) {
      console.log('[Inference] Model is VLM, checking mmproj...');
      const mmprojModelId = `${modelId}-mmproj`;
      console.log('[Inference] MMProj model ID:', mmprojModelId);
      mmprojPath = await this.modelManager.getModelPath(mmprojModelId);
      console.log('[Inference] MMProj path:', mmprojPath);
      const mmprojDownloaded = await this.modelManager.isModelDownloaded(mmprojModelId);
      console.log('[Inference] MMProj downloaded:', mmprojDownloaded);
      if (!mmprojDownloaded) {
        throw new Error('VLM model requires mmproj. Please download it first.');
      }
    } else {
      console.log('[Inference] Model is not VLM or no mmproj URL');
    }

    await this.engineManager.start(modelPath, modelId, mmprojPath);
    this.currentModelId = modelId;
    this.emit('started', modelId);
  }

  public async stop(): Promise<void> {
    await this.engineManager.stop();
    this.currentModelId = '';
    this.emit('stopped');
  }

  public getStatus() {
    const status = this.engineManager.getStatus();
    return {
      ...status,
      modelId: this.currentModelId,
      modelName: this.currentModelId
    };
  }

  public getConfig(): InferenceConfig {
    return { ...this.config };
  }

  public updateConfig(config: Partial<InferenceConfig>): void {
    this.config = { ...this.config, ...config };

    if (config.port !== undefined || config.host !== undefined) {
      this.engineManager.setConfig({
        port: this.config.port,
        host: this.config.host
      });
    }
  }

  public getModelManager(): ModelManager {
    return this.modelManager;
  }

  public getEngineManager(): EngineManager {
    return this.engineManager;
  }

  public async isEngineAvailable(): Promise<boolean> {
    return this.engineManager.isAvailable();
  }
}
