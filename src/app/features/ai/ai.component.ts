import { Component, OnInit, OnDestroy, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  IonHeader, IonToolbar, IonContent, IonFooter,
  IonButton, IonButtons, IonIcon,
  IonProgressBar,
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
  sendOutline, sparklesOutline, trashOutline, stopCircleOutline,
  cloudDownloadOutline, alertCircleOutline, refreshOutline, settingsOutline,
  walletOutline, trendingUpOutline, cardOutline, helpCircleOutline,
  bulbOutline, hardwareChipOutline, bugOutline, copyOutline, closeCircleOutline,
} from 'ionicons/icons';
import { Subject, Subscription, takeUntil } from 'rxjs';
import { Router } from '@angular/router';
import { AiService, AiState, ChatMessage, ModelProgress } from '../../core/services/ai.service';
import { AiContextService } from '../../core/services/ai-context.service';

interface DisplayMessage {
  role: 'user' | 'assistant';
  content: string;
  streaming?: boolean;
  time: string;
}

@Component({
  selector: 'app-ai',
  standalone: true,
  imports: [
    FormsModule,
    IonHeader, IonToolbar, IonContent, IonFooter,
    IonButton, IonButtons, IonIcon,
    IonProgressBar,
  ],
  templateUrl: './ai.component.html',
  styleUrl: './ai.component.css',
})
export class AiComponent implements OnInit, OnDestroy {
  messages: DisplayMessage[] = [];
  userInput = '';
  aiState: AiState = 'idle';
  progress: ModelProgress = { status: 'idle' };
  errorMessage = '';
  inferenceDevice = '';

  // Debug log panel
  logLines: string[] = [];
  showLogs = false;

  private systemPrompt = '';
  private contextSub?: Subscription;
  private destroy$ = new Subject<void>();

  @ViewChild(IonContent) content?: IonContent;

  constructor(
    private ai: AiService,
    private context: AiContextService,
    private router: Router,
  ) {
    addIcons({
      sendOutline, sparklesOutline, trashOutline, stopCircleOutline,
      cloudDownloadOutline, alertCircleOutline, refreshOutline, settingsOutline,
      walletOutline, trendingUpOutline, cardOutline, helpCircleOutline,
      bulbOutline, hardwareChipOutline, bugOutline, copyOutline, closeCircleOutline,
    });
  }

  ngOnInit(): void {
    this.ai.aiState$.pipe(takeUntil(this.destroy$)).subscribe(s => {
      this.aiState = s;
    });

    this.ai.modelProgress$.pipe(takeUntil(this.destroy$)).subscribe(p => {
      this.progress = p;
    });

    this.ai.lastError$.pipe(takeUntil(this.destroy$)).subscribe(e => {
      this.errorMessage = e;
    });

    this.ai.inferenceDevice$.pipe(takeUntil(this.destroy$)).subscribe(d => {
      this.inferenceDevice = d;
    });

    this.ai.debugLog$.pipe(takeUntil(this.destroy$)).subscribe(line => {
      this.logLines.push(line);
      // Cap at 500 lines to avoid memory bloat
      if (this.logLines.length > 500) this.logLines.shift();
    });

    // Add an initial boot entry
    this.logLines.push(`[boot] AI component initialised at ${new Date().toISOString()}`);

    this.contextSub = this.context.getContext$().pipe(takeUntil(this.destroy$)).subscribe(ctx => {
      this.systemPrompt = ctx;
    });

    if (this.ai.currentState === 'idle' || this.ai.currentState === 'error') {
      this.ai.loadModel();
    }
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  goToSettings(): void {
    this.router.navigate(['/settings']);
  }

  toggleLogs(): void {
    this.showLogs = !this.showLogs;
  }

  copyLogs(): void {
    const text = this.logLines.join('\n');
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text).catch(() => {});
    }
    // Also log the copy event itself so it shows in future pastes
    this.logLines.push(`[${new Date().toISOString().slice(11,23)}] --- logs copied to clipboard ---`);
  }

  get isReady(): boolean {
    return this.aiState === 'ready';
  }

  get isGenerating(): boolean {
    return this.aiState === 'generating';
  }

  get isLoading(): boolean {
    return this.aiState === 'loading';
  }

  get downloadPercent(): number {
    return this.progress.progress ?? 0;
  }

  get statusLabel(): string {
    if (this.progress.status === 'initiate') return 'Preparing download...';
    if (this.progress.status === 'download') return `Downloading model... ${Math.round(this.downloadPercent)}%`;
    if (this.progress.status === 'progress') return `Loading... ${Math.round(this.downloadPercent)}%`;
    if (this.progress.status === 'done') return 'Finalizing...';
    if (this.progress.status === 'ready') return 'Model ready!';
    if (this.progress.status === 'loading') return 'Loading model...';
    return 'Preparing...';
  }

  get deviceLabel(): string {
    if (this.inferenceDevice === 'native') return 'On-Device · Offline';
    if (this.inferenceDevice === 'webgpu') return 'WebGPU';
    if (this.inferenceDevice === 'wasm') return 'WASM';
    return '';
  }

  retryLoad(): void {
    this.errorMessage = '';
    this.ai.loadModel();
  }

  clearChat(): void {
    this.messages = [];
  }

  abortGeneration(): void {
    this.ai.abort();
  }

  private nowTime(): string {
    const d = new Date();
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  async sendMessage(): Promise<void> {
    const text = this.userInput.trim();
    if (!text || this.isGenerating || !this.isReady) return;

    this.messages.push({ role: 'user', content: text, time: this.nowTime() });
    this.userInput = '';

    const assistantMsg: DisplayMessage = { role: 'assistant', content: '', streaming: true, time: this.nowTime() };
    this.messages.push(assistantMsg);
    this.scrollToBottom();

    const chatMessages: ChatMessage[] = [
      { role: 'system', content: this.systemPrompt },
      // Keep only the last 6 messages (3 user/assistant exchanges) to avoid
      // prompt size growing past the model's context window on long chats.
      ...this.messages
        .filter(m => !m.streaming || m.content.length > 0)
        .slice(0, -1)
        .slice(-6)
        .map(m => ({ role: m.role as 'user' | 'assistant', content: m.content })),
      { role: 'user' as const, content: text },
    ];

    const tokenSub = this.ai.tokens$.pipe(takeUntil(this.destroy$)).subscribe(token => {
      assistantMsg.content += token;
      assistantMsg.time = this.nowTime();
      this.scrollToBottom();
    });

    try {
      const fullResponse = await this.ai.generate(chatMessages);
      if (!assistantMsg.content && fullResponse) {
        assistantMsg.content = fullResponse;
      }
    } catch (err: any) {
      const msg = err?.message ?? '';
      if (msg.includes('too long') || msg.includes('Prompt too long')) {
        assistantMsg.content = 'Your data is too large for a single prompt. Try clearing the chat and asking a shorter question.';
      } else {
        assistantMsg.content = 'Sorry, something went wrong. Please try again.';
      }
    } finally {
      assistantMsg.streaming = false;
      tokenSub.unsubscribe();
      this.scrollToBottom();
    }
  }

  private scrollToBottom(): void {
    setTimeout(() => {
      this.content?.scrollToBottom(200);
    }, 50);
  }

  readonly suggestions: { icon: string; text: string }[] = [
    { icon: 'wallet-outline', text: 'Where did most of my money go this month?' },
    { icon: 'trending-up-outline', text: 'Am I within budget for all categories?' },
    { icon: 'card-outline', text: 'How much can I still spend this month?' },
    { icon: 'help-circle-outline', text: 'What are my overdue payments?' },
    { icon: 'bulb-outline', text: 'Give me a savings tip based on my spending.' },
  ];

  sendSuggestion(text: string): void {
    this.userInput = text;
    this.sendMessage();
  }
}
