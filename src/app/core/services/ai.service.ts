import { Injectable, NgZone, signal } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { Subject } from 'rxjs';
import { Capacitor } from '@capacitor/core';
import { LlmPlugin } from '../plugins/llm-plugin';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ModelProgress {
  status: string;
  progress?: number;
  file?: string;
}

export type AiState = 'idle' | 'loading' | 'ready' | 'generating' | 'error';

/**
 * AI service powered by MediaPipe LlmInference via a native Capacitor plugin.
 *
 * The AI runs entirely on-device using the GPU/NPU — no WebView WASM needed.
 * Only works on Android (native plugin). On web the feature is disabled.
 */
@Injectable({ providedIn: 'root' })
export class AiService {
  // ─── State (signals) ────────────────────────────────────────────────
  /** Overall state of the AI service. */
  readonly aiState = signal<AiState>('idle');
  /** Model download/load progress. */
  readonly modelProgress = signal<ModelProgress>({ status: 'idle' });
  /** Last error message. */
  readonly lastError = signal<string>('');
  /** Device used for inference. */
  readonly inferenceDevice = signal<string>('');

  // ─── Event streams (Subjects — not state) ───────────────────────────────
  /** Individual tokens streamed during generation. */
  private readonly token$ = new Subject<string>();
  readonly tokens$ = this.token$.asObservable();

  /** Debug log lines — emits a new string for every notable event. */
  private readonly logBus$ = new Subject<string>();
  readonly debugLog$ = this.logBus$.asObservable();

  // ─── Observable aliases (backward compat for async-pipe consumers) ──────
  readonly aiState$ = toObservable(this.aiState);
  readonly modelProgress$ = toObservable(this.modelProgress);
  readonly lastError$ = toObservable(this.lastError);
  readonly inferenceDevice$ = toObservable(this.inferenceDevice);

  private tokenListenerHandle: { remove: () => void } | null = null;
  private progressListenerHandle: { remove: () => void } | null = null;
  private tokenCount = 0;

  constructor(private zone: NgZone) {
    this.setupListeners();
  }

  // ─── Logging helper ─────────────────────────────────────────────────
  private log(msg: string): void {
    const ts = new Date().toISOString().slice(11, 23);
    const line = `[${ts}] ${msg}`;
    console.log('[AI-DEBUG]', line);
    this.logBus$.next(line);
  }

  get currentState(): AiState {
    return this.aiState();
  }

  get isNative(): boolean {
    return Capacitor.isNativePlatform();
  }

  // ─── Event listeners from native plugin ─────────────────────────────
  private async setupListeners(): Promise<void> {
    if (!this.isNative) return;

    try {
      this.progressListenerHandle = await LlmPlugin.addListener('onProgress', (event) => {
        this.zone.run(() => {
          this.log(`progress: status=${event.status} progress=${event.progress?.toFixed(1)} msg=${event.message}`);
          this.modelProgress.set({
            status: event.status,
            progress: event.progress,
          });
        });
      });

      this.tokenListenerHandle = await LlmPlugin.addListener('onToken', (event) => {
        this.zone.run(() => {
          if (!event.done && event.token) {
            this.tokenCount++;
            if (this.tokenCount % 20 === 1) {
              this.log(`token #${this.tokenCount}: "${event.token.slice(0, 30)}"`);
            }
            this.token$.next(event.token);
          }
        });
      });

      this.log('Native event listeners registered');
    } catch (e: any) {
      this.log(`Failed to register listeners: ${e?.message}`);
    }
  }

  // ─── Load model ─────────────────────────────────────────────────────
  /** Download + initialize model. Safe to call multiple times. */
  async loadModel(): Promise<void> {
    if (
      this.aiState() === 'ready' ||
      this.aiState() === 'loading' ||
      this.aiState() === 'generating'
    ) {
      this.log(`loadModel() skipped — already "${this.aiState()}"`);
      return;
    }

    if (!this.isNative) {
      this.log('loadModel() — not on native platform, AI unavailable');
      this.aiState.set('error');
      this.lastError.set('AI is only available on Android (native device).');
      return;
    }

    this.log('loadModel() → state=loading');
    this.aiState.set('loading');
    this.lastError.set('');

    try {
      // 1. Check current status
      const status = await LlmPlugin.getModelStatus();
      this.log(`Model status: downloaded=${status.downloaded} initialized=${status.initialized} size=${status.modelSizeMB ?? '?'}MB`);

      // 2. Download if needed
      if (!status.downloaded) {
        this.log('Starting model download...');
        this.modelProgress.set({ status: 'download', progress: 0 });
        const downloadResult = await LlmPlugin.downloadModel();
        this.log(`Download result: ${JSON.stringify(downloadResult)}`);
        if (!downloadResult.success) {
          throw new Error('Model download failed');
        }
      } else {
        this.log('Model already downloaded, skipping download');
      }

      // 3. Initialize the inference engine
      if (!status.initialized) {
        this.log('Initializing inference engine...');
        this.modelProgress.set({ status: 'loading', progress: 80 });
        const initResult = await LlmPlugin.initialize();
        this.log(`Init result: ${JSON.stringify(initResult)}`);
        if (!initResult.success) {
          throw new Error('Model initialization failed');
        }
      }

      // 4. Ready!
      this.log('Model ready — MediaPipe native');
      this.aiState.set('ready');
      this.inferenceDevice.set('native');
      this.modelProgress.set({ status: 'ready', progress: 100 });
    } catch (e: any) {
      this.log(`loadModel() ERROR: ${e?.message ?? e}`);
      this.aiState.set('error');
      this.lastError.set(e?.message ?? 'Failed to load AI model');
    }
  }

  // ─── Generate ───────────────────────────────────────────────────────
  /**
   * Build a Qwen chat prompt from the conversation messages and send to native.
   * Tokens stream via `tokens$`. Returns the full response text.
   */
  async generate(messages: ChatMessage[]): Promise<string> {
    if (this.aiState() !== 'ready') {
      this.log(`generate() rejected — state="${this.aiState()}"`);
      throw new Error('Model not ready');
    }

    this.log(`generate() — ${messages.length} messages, state→generating`);
    this.tokenCount = 0;
    this.aiState.set('generating');
    this.lastError.set('');

    try {
      // Build a plain-text prompt in Qwen chat-template format
      const prompt = this.buildChatPrompt(messages);
      this.log(`Prompt length: ${prompt.length} chars`);

      const result = await LlmPlugin.generate({ prompt });
      const response = result.response ?? '';

      this.log(`generate() done — ${response.length} chars, ${this.tokenCount} tokens`);
      this.aiState.set('ready');
      return response;
    } catch (e: any) {
      this.log(`generate() ERROR: ${e?.message ?? e}`);
      this.aiState.set('error');
      this.lastError.set(e?.message ?? 'Generation failed');
      return '';
    }
  }

  /** Abort in-flight generation (reset the engine). */
  async abort(): Promise<void> {
    this.log('abort() called');
    try {
      await LlmPlugin.reset();
      // Re-initialize after reset
      this.aiState.set('loading');
      await LlmPlugin.initialize();
      this.aiState.set('ready');
      this.log('abort() complete, model re-initialized');
    } catch (e: any) {
      this.log(`abort() error: ${e?.message}`);
      this.aiState.set('error');
      this.lastError.set('Failed to reset model');
    }
  }

  /**
   * Cleanly shuts down the native inference engine before an app reload.
   * Call this before `window.location.reload()` to avoid double-init crashes
   * caused by the Android LlmPlugin persisting across WebView reloads.
   */
  async shutdown(): Promise<void> {
    if (!this.isNative) return;
    this.log('shutdown() — releasing native model for app reload');
    try {
      await LlmPlugin.reset();
      this.aiState.set('idle');
      this.log('shutdown() complete — plugin reset, state→idle');
    } catch (e: any) {
      // Non-fatal — log and continue; reload will proceed regardless
      this.log(`shutdown() error (non-fatal): ${e?.message}`);
    }
  }

  // ─── Prompt formatting ──────────────────────────────────────────────
  /**
   * Builds a Qwen 2.5 chat-template prompt.
   * Format:
   *   <|im_start|>system\n{content}<|im_end|>\n
   *   <|im_start|>user\n{content}<|im_end|>\n
   *   <|im_start|>assistant\n
   */
  private buildChatPrompt(messages: ChatMessage[]): string {
    const parts: string[] = [];
    for (const msg of messages) {
      parts.push(`<|im_start|>${msg.role}\n${msg.content}<|im_end|>`);
    }
    // Add the assistant opening tag so the model continues from there
    parts.push('<|im_start|>assistant\n');
    return parts.join('\n');
  }
}
