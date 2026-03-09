import { Injectable, NgZone } from '@angular/core';
import { BehaviorSubject, Observable, Subject } from 'rxjs';

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

@Injectable({ providedIn: 'root' })
export class AiService {
  private worker: Worker | null = null;

  private state$ = new BehaviorSubject<AiState>('idle');
  private progress$ = new BehaviorSubject<ModelProgress>({ status: 'idle' });
  private token$ = new Subject<string>();
  private error$ = new BehaviorSubject<string>('');
  private device$ = new BehaviorSubject<string>('');

  /** Overall state of the AI service */
  readonly aiState$ = this.state$.asObservable();
  /** Model download/load progress */
  readonly modelProgress$ = this.progress$.asObservable();
  /** Individual tokens streamed during generation */
  readonly tokens$ = this.token$.asObservable();
  /** Last error message */
  readonly lastError$ = this.error$.asObservable();
  /** Device used for inference (webgpu | wasm) */
  readonly inferenceDevice$ = this.device$.asObservable();

  /** Resolved once the current generation is complete (full text). */
  private doneResolve: ((text: string) => void) | null = null;

  constructor(private zone: NgZone) {}

  get currentState(): AiState {
    return this.state$.value;
  }

  /** Load model in the Web Worker. Safe to call multiple times — no-ops if already loaded/loading. */
  loadModel(): void {
    if (this.state$.value === 'ready' || this.state$.value === 'loading') return;

    this.state$.next('loading');
    this.error$.next('');
    this.ensureWorker();
    this.worker!.postMessage({ type: 'load' });
  }

  /** Send a chat completion request. Returns the full response text. Tokens stream via `tokens$`. */
  generate(messages: ChatMessage[]): Promise<string> {
    if (this.state$.value !== 'ready') {
      return Promise.reject(new Error('Model not ready'));
    }

    this.state$.next('generating');
    this.error$.next('');
    this.ensureWorker();

    return new Promise<string>((resolve) => {
      this.doneResolve = resolve;
      this.worker!.postMessage({ type: 'generate', payload: { messages } });
    });
  }

  /** Abort in-flight generation. */
  abort(): void {
    this.worker?.postMessage({ type: 'abort' });
  }

  // ─── Worker lifecycle ────────────────────────────────────────────────
  private ensureWorker(): void {
    if (this.worker) return;

    this.worker = new Worker(new URL('./../../features/ai/ai.worker.ts', import.meta.url), { type: 'module' });

    this.worker.onmessage = (event: MessageEvent) => {
      this.zone.run(() => this.handleMessage(event.data));
    };

    this.worker.onerror = (err) => {
      this.zone.run(() => {
        this.state$.next('error');
        this.error$.next(err.message ?? 'Worker error');
      });
    };
  }

  private handleMessage(msg: { type: string; payload?: any }): void {
    switch (msg.type) {
      case 'progress':
        this.progress$.next(msg.payload);
        break;

      case 'ready':
        this.state$.next('ready');
        this.progress$.next({ status: 'ready', progress: 100 });
        this.device$.next(msg.payload?.device ?? 'wasm');
        break;

      case 'token':
        this.token$.next(msg.payload);
        break;

      case 'done':
        this.state$.next('ready');
        if (this.doneResolve) {
          this.doneResolve(msg.payload ?? '');
          this.doneResolve = null;
        }
        break;

      case 'error':
        this.state$.next('error');
        this.error$.next(msg.payload ?? 'Unknown error');
        if (this.doneResolve) {
          this.doneResolve('');
          this.doneResolve = null;
        }
        break;
    }
  }
}
