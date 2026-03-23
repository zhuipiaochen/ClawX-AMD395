import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import fs from 'fs/promises';
import { app } from 'electron';

export interface EngineConfig {
  port: number;
  host: string;
  modelPath: string;
  gpuLayers: number;
  threads: number;
  contextSize: number;
}

export interface EngineStatus {
  running: boolean;
  modelId?: string;
  modelName?: string;
  port?: number;
  pid?: number;
}

export class EngineManager {
  private process: ChildProcess | null = null;
  private config: EngineConfig;
  private serverPath: string;

  constructor() {
    this.config = {
      port: 18432,
      host: '127.0.0.1',
      gpuLayers: 99,
      threads: 4,
      contextSize: 194000
    };
    console.log('[EngineManager] Constructor initialized with config:', JSON.stringify(this.config));

    const isDev = !app.isPackaged;
    const baseDir = isDev 
      ? path.join(process.cwd())
      : path.dirname(app.getPath('exe'));
    const llamaPath = path.join(baseDir, 'resources', 'bin', 'llama.cpp', 'win32-x64');
    this.serverPath = path.join(llamaPath, 'llama-server.exe');
    console.log('[EngineManager] Base dir:', baseDir);
    console.log('[EngineManager] Llama path:', llamaPath);
    console.log('[EngineManager] Server path:', this.serverPath);
  }

  public async isAvailable(): Promise<boolean> {
    try {
      console.log('[EngineManager] Checking availability at:', this.serverPath);
      const stats = await fs.stat(this.serverPath);
      console.log('[EngineManager] File stats:', JSON.stringify(stats));
      return stats.isFile() && stats.size > 0;
    } catch (error) {
      console.error('[EngineManager] File error:', error);
      return false;
    }
  }

  public setConfig(config: Partial<EngineConfig>): void {
    const oldConfig = { ...this.config };
    this.config = { ...this.config, ...config };
    console.log('[EngineManager] Config updated:', {
      old: oldConfig,
      new: this.config,
      changes: config
    });
  }

  public getConfig(): EngineConfig {
    return { ...this.config };
  }

  public async start(modelPath: string, modelId: string, mmprojPath?: string): Promise<void> {
    if (this.process) {
      console.log('[EngineManager] Engine is already running, stopping it first...');
      await this.stop();
    }

    if (!modelPath) {
      throw new Error('Model path is required');
    }

    const isAvailable = await this.isAvailable();
    if (!isAvailable) {
      throw new Error(`llama-server.exe not found at ${this.serverPath}`);
    }

    console.log('[EngineManager] Model ID:', modelId);
    console.log('[EngineManager] Model path:', modelPath);
    console.log('[EngineManager] MMProj path:', mmprojPath);
    console.log('[EngineManager] Config:', JSON.stringify(this.config));
    console.log('[EngineManager] Full config:', {
      port: this.config.port,
      host: this.config.host,
      contextSize: this.config.contextSize,
      threads: this.config.threads,
      gpuLayers: this.config.gpuLayers
    });

    const args = [
      '-m', modelPath,
      '--port', this.config.port.toString(),
      '--host', this.config.host,
      '-ngl', this.config.gpuLayers.toString(),
      '--ctx-size', this.config.contextSize.toString(),
      '--flash-attn', 'on',
      '--no-warmup'
    ];
    if (this.config.threads > 0) {
      args.push('-t', this.config.threads.toString());
    }
    console.log('[EngineManager] Full command arguments:', args);

    if (mmprojPath) {
      args.push('--mmproj', mmprojPath);
    }

    console.log('[EngineManager] Starting llama-server:', this.serverPath);
    console.log('[EngineManager] Args:', args.join(' '));
    console.log('[EngineManager] Model path:', modelPath);

    try {
      this.process = spawn(this.serverPath, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: false,
        shell: false,
        cwd: path.dirname(this.serverPath)
      });

      this.process.stdout?.on('data', (data) => {
        const msg = data.toString().trim();
        console.log('[llama-server stdout]:', msg);
        
        if (msg.includes('llama server listening') || msg.includes('server started')) {
          console.log('[EngineManager] SUCCESS: llama-server started successfully!');
          console.log('[EngineManager] Model loaded, port is now listening');
        }
      });

      this.process.stderr?.on('data', (data) => {
        const errorMsg = data.toString().trim();
        console.error('[llama-server stderr]:', errorMsg);
        
        if (errorMsg.toLowerCase().includes('out of memory') || errorMsg.toLowerCase().includes('oom')) {
          console.error('[EngineManager] FATAL: Out of memory error detected!');
          throw new Error('内存不足，无法加载此模型。请尝试：\n1. 减少GPU层数（当前：99）\n2. 减少上下文大小（当前：194000）\n3. 关闭其他占用内存的程序\n4. 升级系统内存');
        }
        
        if (errorMsg.toLowerCase().includes('failed to mmap') || errorMsg.toLowerCase().includes('cannot allocate')) {
          console.error('[EngineManager] FATAL: Memory allocation error detected!');
          throw new Error('内存分配失败，无法加载此模型。请检查系统内存和GPU显存是否充足。');
        }
      });
      
      this.process.on('exit', (code, signal) => {
        console.log('[EngineManager] llama-server exited!');
        console.log('[EngineManager] Exit code:', code);
        console.log('[EngineManager] Exit signal:', signal);
        console.log('[EngineManager] Current status:', this.getStatus());
        console.log('[EngineManager] Process was running:', !!this.process);
        this.process = null;
      }, { once: true });

      this.process.on('error', (error) => {
        console.error('[EngineManager] llama-server process error:', error);
        console.error('[EngineManager] Error code:', (error as NodeJS.ErrnoException).code);
        console.error('[EngineManager] Error message:', error.message);
        this.process = null;
      }, { once: true });

      await this.waitForServer(60000);
    } catch (error) {
      console.error('[EngineManager] Failed to start engine:', error);
      this.process = null;
      throw error;
    }
  }

  private async waitForServer(timeout: number): Promise<void> {
    const start = Date.now();

    while (Date.now() - start < timeout) {
      try {
        const response = await fetch(`http://${this.config.host}:${this.config.port}/health`);
        if (response.ok) {
          return;
        }
      } catch {
        // Server not ready yet
      }
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }

  public async stop(): Promise<void> {
    if (!this.process) {
      return;
    }

    return new Promise((resolve) => {
      this.process!.on('exit', () => {
        this.process = null;
        resolve();
      });

      this.process!.on('error', () => {
        this.process = null;
        resolve();
      });

      if (process.platform === 'win32') {
        spawn('taskkill', ['/pid', this.process.pid!.toString(), '/T', '/F']);
      } else {
        this.process.kill('SIGTERM');
      }

      setTimeout(() => {
        if (this.process) {
          this.process.kill('SIGKILL');
          this.process = null;
        }
        resolve();
      }, 5000);
    });
  }

  public getStatus(): EngineStatus {
    return {
      running: !!this.process,
      port: this.config.port,
      pid: this.process?.pid
    };
  }

  public async healthCheck(): Promise<boolean> {
    if (!this.process) {
      return false;
    }

    try {
      const response = await fetch(`http://${this.config.host}:${this.config.port}/health`);
      return response.ok;
    } catch {
      return false;
    }
  }
}
