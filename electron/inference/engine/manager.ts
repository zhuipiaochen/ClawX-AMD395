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
      port: 8080,
      host: 'localhost',
      modelPath: '',
      gpuLayers: 99,
      threads: 4,
      contextSize: 32768
    };

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
    this.config = { ...this.config, ...config };
  }

  public getConfig(): EngineConfig {
    return { ...this.config };
  }

  public async start(modelPath: string, modelId: string, mmprojPath?: string): Promise<void> {
    if (this.process) {
      throw new Error('Engine is already running');
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

    const args = [
      '-m', modelPath,
      '--port', this.config.port.toString(),
      '--host', this.config.host,
      '-c', this.config.contextSize.toString(),
      '-t', this.config.threads.toString(),
      '-ngl', this.config.gpuLayers.toString(),
      '--log-disable'
    ];

    if (mmprojPath) {
      args.push('--mmproj', mmprojPath);
    }

    console.log('Starting llama-server:', this.serverPath, args);
    console.log('Model path:', modelPath);

    this.process = spawn(this.serverPath, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: false,
      shell: false,
      cwd: path.dirname(this.serverPath)
    });

    this.process.stdout?.on('data', (data) => {
      console.log('[llama-server stdout]:', data.toString().trim());
    });

    this.process.stderr?.on('data', (data) => {
      console.error('[llama-server stderr]:', data.toString().trim());
    });

    this.process.on('exit', (code) => {
      console.log('llama-server exited with code:', code);
      this.process = null;
    });

    this.process.on('error', (error) => {
      console.error('llama-server process error:', error);
    });

    await this.waitForServer(15000);
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
