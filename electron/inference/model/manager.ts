import fs from 'fs/promises';
import path from 'path';
import { createWriteStream } from 'fs';

export interface ModelInfo {
  id: string;
  name: string;
  description?: string;
  size: number;
  url?: string;
  filename?: string;
  downloads?: number;
  mmprojUrl?: string;
  isVlm?: boolean;
}

export interface DownloadProgress {
  total: number;
  downloaded: number;
  percentage: number;
  speed: number;
}

export class ModelManager {
  private baseDir: string;

  constructor() {
    const appData = process.env.APPDATA || path.join(process.env.HOME || '', 'AppData', 'Roaming');
    this.baseDir = path.join(appData, 'ClawX', 'models');
  }

  private getModelDir(modelId: string): string {
    const baseName = modelId.replace('-mmproj', '').replace(/-Q4_.*$/, '');
    return path.join(this.baseDir, baseName);
  }

  private getModelFilename(modelId: string): string {
    if (modelId.includes('-mmproj')) {
      return 'mmproj-F16.gguf';
    }
    return `${modelId}.gguf`;
  }

  public async getModelPath(modelId: string): Promise<string> {
    const modelDir = this.getModelDir(modelId);
    const filename = this.getModelFilename(modelId);
    const fullPath = path.join(modelDir, filename);
    
    try {
      await fs.access(fullPath);
      return fullPath;
    } catch {
      try {
        const files = await fs.readdir(modelDir);
        const ggufFile = files.find(f => f.endsWith('.gguf') && !f.includes('mmproj'));
        if (ggufFile) {
          return path.join(modelDir, ggufFile);
        }
      } catch {
        // ignore
      }
    }
    
    return fullPath;
  }

  public async initialize(): Promise<void> {
    await fs.mkdir(this.baseDir, { recursive: true });
  }

  public async getModelsDir(): Promise<string> {
    return this.baseDir;
  }

  public async isModelDownloaded(id: string): Promise<boolean> {
    const modelPath = await this.getModelPath(id);
    try {
      const stats = await fs.stat(modelPath);
      return stats.isFile() && stats.size > 0;
    } catch {
      return false;
    }
  }

  public async downloadModel(
    modelId: string,
    downloadUrl: string,
    onProgress?: (progress: DownloadProgress) => void
  ): Promise<string> {
    const modelPath = await this.getModelPath(modelId);
    const modelDir = this.getModelDir(modelId);
    console.log('[Download] Starting download:', modelId, 'URL:', downloadUrl);
    console.log('[Download] Model path:', modelPath);
    
    await fs.mkdir(modelDir, { recursive: true });

    const response = await fetch(downloadUrl);
    console.log('[Download] Response status:', response.status, response.statusText);
    
    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      console.error('[Download] Error response:', errorText);
      throw new Error(`Failed to download: ${response.status} ${response.statusText}. ${errorText}`);
    }

    const total = parseInt(response.headers.get('content-length') || '0');
    let downloaded = 0;
    const startTime = Date.now();

    const writer = createWriteStream(modelPath);

    for await (const chunk of response.body as AsyncIterable<Buffer>) {
      downloaded += chunk.length;
      writer.write(chunk);

      if (onProgress && total > 0) {
        const elapsed = (Date.now() - startTime) / 1000;
        const speed = downloaded / elapsed / (1024 * 1024);
        const percentage = (downloaded / total) * 100;

        onProgress({ total, downloaded, percentage, speed });
      }
    }

    writer.end();
    return modelPath;
  }

  public async deleteModel(modelId: string): Promise<void> {
    const modelDir = this.getModelDir(modelId);
    try {
      await fs.rm(modelDir, { recursive: true, force: true });
    } catch (error) {
      console.error(`Failed to delete model ${modelId}:`, error);
      throw error;
    }
  }

  public async getLocalModels(): Promise<ModelInfo[]> {
    const localModels: ModelInfo[] = [];

    try {
      await fs.access(this.baseDir);
      const modelDirs = await fs.readdir(this.baseDir);
      console.log('[ModelManager] Scanning models directory:', this.baseDir);
      console.log('[ModelManager] Found directories:', modelDirs);

      for (const dir of modelDirs) {
        const dirPath = path.join(this.baseDir, dir);
        const stats = await fs.stat(dirPath);
        
        if (stats.isDirectory()) {
          const files = await fs.readdir(dirPath);
          const ggufFiles = files.filter(f => f.endsWith('.gguf'));
          
          console.log(`[ModelManager] [${dir}] files:`, files);
          console.log(`[ModelManager] [${dir}] ggufFiles:`, ggufFiles);
          
          if (ggufFiles.length > 0) {
            let modelId = dir;
            let isVlm = false;
            
            const mainFile = ggufFiles.find(f => !f.includes('mmproj')) || ggufFiles[0];
            if (mainFile) {
              modelId = mainFile.replace('.gguf', '');
              isVlm = ggufFiles.some(f => f.includes('mmproj'));
            }
            
            console.log(`[ModelManager] [${dir}] modelId: ${modelId}, isVlm: ${isVlm}, mainFile: ${mainFile}`);
            
            const mainFilePath = path.join(dirPath, mainFile);
            const fileStats = await fs.stat(mainFilePath);

            localModels.push({
              id: modelId,
              name: dir,
              size: fileStats.size,
              filename: mainFile,
              isVlm
            });
          }
        }
      }
      
      console.log('[ModelManager] Local models found:', localModels.map(m => ({ id: m.id, name: m.name })));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.error('Failed to get local models:', error);
      }
    }

    return localModels;
  }

  public async searchModels(query: string): Promise<ModelInfo[]> {
    try {
      const response = await fetch(`https://hf-mirror.com/api/models?search=${encodeURIComponent(query)}&filter=gguf&sort=downloads&direction=-1&limit=10`);
      if (!response.ok) {
        throw new Error(`Search failed: ${response.statusText}`);
      }
      const data = await response.json() as Array<{
        id: string;
        model_id: string;
        downloads: number;
      }>;
      return data.map(item => ({
        id: item.model_id.replace('/', '-'),
        name: item.model_id,
        description: `${item.downloads?.toLocaleString() || 0} downloads`,
        size: 0,
        downloads: item.downloads
      }));
    } catch (error) {
      console.error('Search failed:', error);
      return [];
    }
  }

  public getRecommendedModels(): ModelInfo[] {
    return [
      {
        id: 'Qwen3.5-35B-A3B-Q4_K_M',
        name: 'Qwen3.5-35B-A3B',
        description: '⭐ AMD 395推荐 | VLM模型 | ~22GB',
        size: 22 * 1024 * 1024 * 1024,
        url: 'https://hf-mirror.com/unsloth/Qwen3.5-35B-A3B-GGUF/resolve/main/Qwen3.5-35B-A3B-Q4_K_M.gguf',
        mmprojUrl: 'https://hf-mirror.com/unsloth/Qwen3.5-35B-A3B-GGUF/resolve/main/mmproj-F16.gguf',
        isVlm: true
      },
      {
        id: 'Qwen3.5-4B-Q4_K_M',
        name: 'Qwen3.5-4B',
        description: 'VLM模型 | ~3GB',
        size: 3 * 1024 * 1024 * 1024,
        url: 'https://hf-mirror.com/unsloth/Qwen3.5-4B-GGUF/resolve/main/Qwen3.5-4B-Q4_K_M.gguf',
        mmprojUrl: 'https://hf-mirror.com/unsloth/Qwen3.5-4B-GGUF/resolve/main/mmproj-F16.gguf',
        isVlm: true
      },
      {
        id: 'Qwen3.5-2B-Q4_K_M',
        name: 'Qwen3.5-2B',
        description: 'VLM模型 | ~2GB',
        size: 2 * 1024 * 1024 * 1024,
        url: 'https://hf-mirror.com/unsloth/Qwen3.5-2B-GGUF/resolve/main/Qwen3.5-2B-Q4_K_M.gguf',
        mmprojUrl: 'https://hf-mirror.com/unsloth/Qwen3.5-2B-GGUF/resolve/main/mmproj-F16.gguf',
        isVlm: true
      },
      {
        id: 'Qwen3.5-0.8B-Q4_K_M',
        name: 'Qwen3.5-0.8B',
        description: 'VLM模型 | ~1GB',
        size: 1 * 1024 * 1024 * 1024,
        url: 'https://hf-mirror.com/unsloth/Qwen3.5-0.8B-GGUF/resolve/main/Qwen3.5-0.8B-Q4_K_M.gguf',
        mmprojUrl: 'https://hf-mirror.com/unsloth/Qwen3.5-0.8B-GGUF/resolve/main/mmproj-F16.gguf',
        isVlm: true
      },
      {
        id: 'Qwen3-0.6B-Q4_K_M',
        name: 'Qwen3-0.6B',
        description: 'LLM模型 | ~400MB | 无需mmproj',
        size: 400 * 1024 * 1024,
        url: 'https://hf-mirror.com/unsloth/Qwen3-0.6B-GGUF/resolve/main/Qwen3-0.6B-Q4_K_M.gguf',
        isVlm: false
      }
    ];
  }
}
