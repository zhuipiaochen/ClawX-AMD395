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

  public getModelPath(modelId: string): string {
    const modelDir = this.getModelDir(modelId);
    const filename = this.getModelFilename(modelId);
    return path.join(modelDir, filename);
  }

  public async initialize(): Promise<void> {
    await fs.mkdir(this.baseDir, { recursive: true });
  }

  public async getModelsDir(): Promise<string> {
    return this.baseDir;
  }

  public async isModelDownloaded(id: string): Promise<boolean> {
    const modelPath = this.getModelPath(id);
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
    const modelPath = this.getModelPath(modelId);
    const modelDir = this.getModelDir(modelId);
    console.log('[Download] Starting download:', modelId, 'URL:', downloadUrl);
    console.log('[Download] Model path:', modelPath);
    
    await fs.mkdir(modelDir, { recursive: true });

    const response = await fetch(downloadUrl);
    console.log('[Download] Response status:', response.status, response.statusText);
    
    if (!response.ok) {
      throw new Error(`Failed to download: ${response.statusText}`);
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

      for (const dir of modelDirs) {
        const dirPath = path.join(this.baseDir, dir);
        const stats = await fs.stat(dirPath);
        
        if (stats.isDirectory()) {
          const files = await fs.readdir(dirPath);
          const ggufFiles = files.filter(f => f.endsWith('.gguf'));
          
          if (ggufFiles.length > 0) {
            let modelId = dir;
            let isVlm = false;
            
            const mainFile = ggufFiles.find(f => !f.includes('mmproj')) || ggufFiles[0];
            if (mainFile) {
              modelId = mainFile.replace('.gguf', '');
              isVlm = ggufFiles.some(f => f.includes('mmproj'));
            }

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
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.error('Failed to get local models:', error);
      }
    }

    return localModels;
  }

  public async searchModels(query: string): Promise<ModelInfo[]> {
    try {
      const response = await fetch(`https://huggingface.co/api/models?search=${encodeURIComponent(query)}&filter=gguf&sort=downloads&direction=-1&limit=10`);
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
        id: 'Qwen3.5-32B-Q4_K_M',
        name: 'Qwen3.5-32B',
        description: '⭐ 推荐 | ~20GB | 纯文本模型 | AMD 395推荐',
        size: 20 * 1024 * 1024 * 1024,
        url: 'https://hf-mirror.com/Qwen/Qwen3-32B-GGUF/resolve/main/Qwen3-32B-Q4_K_M.gguf',
        isVlm: false
      },
      {
        id: 'Qwen3.5-35B-A3B-Q4_K_M',
        name: 'Qwen3.5-35B-A3B',
        description: 'VLM | ~22GB | 支持图片 | 需要mmproj',
        size: 22 * 1024 * 1024 * 1024,
        url: 'https://hf-mirror.com/unsloth/Qwen3.5-35B-A3B-GGUF/resolve/main/Qwen3.5-35B-A3B-Q4_K_M.gguf',
        mmprojUrl: 'https://hf-mirror.com/unsloth/Qwen3.5-35B-A3B-GGUF/resolve/main/mmproj-F16.gguf',
        isVlm: true
      },
      {
        id: 'Qwen3.5-14B-Q4_K_M',
        name: 'Qwen3.5-14B',
        description: '~9GB | 纯文本模型 | 快速',
        size: 9 * 1024 * 1024 * 1024,
        url: 'https://hf-mirror.com/Qwen/Qwen3-14B-GGUF/resolve/main/Qwen3-14B-Q4_K_M.gguf',
        isVlm: false
      },
      {
        id: 'Qwen3.5-8B-Q4_K_M',
        name: 'Qwen3.5-8B',
        description: '~5GB | 纯文本模型 | 最快',
        size: 5 * 1024 * 1024 * 1024,
        url: 'https://hf-mirror.com/Qwen/Qwen3-8B-GGUF/resolve/main/Qwen3-8B-Q4_K_M.gguf',
        isVlm: false
      },
      {
        id: 'Qwen3.5-0.8B-Q4_0',
        name: 'Qwen3.5-0.8B',
        description: 'VLM | ~1GB | 支持图片 | 需要mmproj',
        size: 1 * 1024 * 1024 * 1024,
        url: 'https://hf-mirror.com/unsloth/Qwen3.5-0.8B-GGUF/resolve/main/Qwen3.5-0.8B-Q4_0.gguf',
        mmprojUrl: 'https://hf-mirror.com/unsloth/Qwen3.5-0.8B-GGUF/resolve/main/mmproj-F16.gguf',
        isVlm: true
      }
    ];
  }
}
