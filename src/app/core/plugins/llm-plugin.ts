/**
 * TypeScript definitions for the native LlmPlugin (Capacitor bridge).
 *
 * On Android, this calls into com.zerowallet.tracker.LlmPlugin (MediaPipe).
 * On web, all methods reject — the AI feature is Android-only.
 */
import { registerPlugin } from '@capacitor/core';

export interface ModelStatus {
  downloaded: boolean;
  initialized: boolean;
  generating: boolean;
  modelSizeMB?: number;
}

export interface DownloadResult {
  success: boolean;
  message?: string;
}

export interface InitResult {
  success: boolean;
  message?: string;
}

export interface GenerateResult {
  response: string;
}

export interface TokenEvent {
  token: string;
  done: boolean;
}

export interface ProgressEvent {
  status: string;
  progress: number;
  message: string;
}

export interface LlmPluginInterface {
  getModelStatus(): Promise<ModelStatus>;
  downloadModel(): Promise<DownloadResult>;
  initialize(): Promise<InitResult>;
  generate(options: { prompt: string }): Promise<GenerateResult>;
  reset(): Promise<{ success: boolean }>;
  deleteModel(): Promise<{ success: boolean }>;

  addListener(eventName: 'onToken', handler: (event: TokenEvent) => void): Promise<{ remove: () => void }>;
  addListener(eventName: 'onProgress', handler: (event: ProgressEvent) => void): Promise<{ remove: () => void }>;
}

export const LlmPlugin = registerPlugin<LlmPluginInterface>('LlmPlugin');
