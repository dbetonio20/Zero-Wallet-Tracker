import { Injectable, NgZone } from '@angular/core';
import { BehaviorSubject, Subject } from 'rxjs';
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
  private state$ = new BehaviorSubject<AiState>('idle');
  private progress$ = new BehaviorSubject<ModelProgress>({ status: 'idle' });
  private token$ = new Subject<string>();
  private error$ = new BehaviorSubject<string>('');
  private device$ = new BehaviorSubject<string>('');

  /** Debug log lines — emits a new string for every notable event. */
  private logBus$ = new Subject<string>();
  readonly debugLog$ = this.logBus$.asObservable();

  /** Overall state of the AI service */
  readonly aiState$ = this.state$.asObservable();
  /** Model download/load progress */
  readonly modelProgress$ = this.progress$.asObservable();
  /** Individual tokens streamed during generation */
  readonly tokens$ = this.token$.asObservable();
  /** Last error message */
  readonly lastError$ = this.error$.asObservable();
  /** Device used for inference */
  readonly inferenceDevice$ = this.device$.asObservable();

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
    return this.state$.value;
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
          this.progress$.next({
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
      this.state$.value === 'ready' ||
      this.state$.value === 'loading' ||
      this.state$.value === 'generating'
    ) {
      this.log(`loadModel() skipped — already "${this.state$.value}"`);
      return;
    }

    if (!this.isNative) {
      this.log('loadModel() — not on native platform, AI unavailable');
      this.state$.next('error');
      this.error$.next('AI is only available on Android (native device).');
      return;
    }

    this.log('loadModel() → state=loading');
    this.state$.next('loading');
    this.error$.next('');

    try {
      // 1. Check current status
      const status = await LlmPlugin.getModelStatus();
      this.log(`Model status: downloaded=${status.downloaded} initialized=${status.initialized} size=${status.modelSizeMB ?? '?'}MB`);

      // 2. Download if needed
      if (!status.downloaded) {
        this.log('Starting model download...');
        this.progress$.next({ status: 'download', progress: 0 });
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
        this.progress$.next({ status: 'loading', progress: 80 });
        const initResult = await LlmPlugin.initialize();
        this.log(`Init result: ${JSON.stringify(initResult)}`);
        if (!initResult.success) {
          throw new Error('Model initialization failed');
        }
      }

      // 4. Ready!
      this.log('Model ready — MediaPipe native');
      this.state$.next('ready');
      this.device$.next('native');
      this.progress$.next({ status: 'ready', progress: 100 });
    } catch (e: any) {
      this.log(`loadModel() ERROR: ${e?.message ?? e}`);
      this.state$.next('error');
      this.error$.next(e?.message ?? 'Failed to load AI model');
    }
  }

  // ─── Generate ───────────────────────────────────────────────────────
  /**
   * Build a Qwen chat prompt from the conversation messages and send to native.
   * Tokens stream via `tokens$`. Returns the full response text.
   */
  async generate(messages: ChatMessage[]): Promise<string> {
    if (this.state$.value !== 'ready') {
      this.log(`generate() rejected — state="${this.state$.value}"`);
      throw new Error('Model not ready');
    }

    this.log(`generate() — ${messages.length} messages, state→generating`);
    this.tokenCount = 0;
    this.state$.next('generating');
    this.error$.next('');

    try {
      // Build a plain-text prompt in Qwen chat-template format
      const prompt = this.buildChatPrompt(messages);
      this.log(`Prompt length: ${prompt.length} chars`);

      const result = await LlmPlugin.generate({ prompt });
      const response = result.response ?? '';

      this.log(`generate() done — ${response.length} chars, ${this.tokenCount} tokens`);
      this.state$.next('ready');
      return response;
    } catch (e: any) {
      this.log(`generate() ERROR: ${e?.message ?? e}`);
      this.state$.next('error');
      this.error$.next(e?.message ?? 'Generation failed');
      return '';
    }
  }

  /** Abort in-flight generation (reset the engine). */
  async abort(): Promise<void> {
    this.log('abort() called');
    try {
      await LlmPlugin.reset();
      // Re-initialize after reset
      this.state$.next('loading');
      await LlmPlugin.initialize();
      this.state$.next('ready');
      this.log('abort() complete, model re-initialized');
    } catch (e: any) {
      this.log(`abort() error: ${e?.message}`);
      this.state$.next('error');
      this.error$.next('Failed to reset model');
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
      this.state$.next('idle');
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
