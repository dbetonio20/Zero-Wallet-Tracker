# Local AI Chat Assistant — Implementation Plan

> **Status:** Pending — to be implemented after app is near complete.

---

## Overview

Add a 5th "AI Assistant" tab powered by [Transformers.js v3](https://huggingface.co/docs/transformers.js) (`@huggingface/transformers`), which runs ONNX-quantized language models directly in the browser's WASM runtime — no internet after the first download, no native code, no server.

The model runs inside a **Web Worker** so the UI stays smooth on mobile. On first launch it downloads and caches the model (~360–700MB) into the browser's Cache API; all subsequent sessions are 100% offline. The AI is given a snapshot of all financial data (expenses, income, installments, credit cards, monthly summaries) as a system prompt so it can answer questions in context.

---

## User Decisions

| Decision | Choice |
|---|---|
| AI Approach | Download on first use (~360–700MB), cached offline forever |
| AI Location | New dedicated tab in the bottom tab bar (5th tab) |
| AI Awareness | Everything — expenses, income, installments, credit cards, reports/summaries |

---

## Implementation Steps

### 1. Install Dependency
Add `@huggingface/transformers` to `package.json` via Bun. No Angular-specific wrapper needed; library is ESM-compatible.

```bash
bun add @huggingface/transformers
```

---

### 2. Choose Model
Use `onnx-community/Qwen2.5-0.5B-Instruct` (INT4 quantized, ≈350 MB) as the default.
- Fits the 360–700MB target
- Runs on mobile WebView WASM
- Understands financial Q&A well

> Swap to `Qwen2.5-1.5B-Instruct` for better quality at ~700MB.

---

### 3. Create Web Worker — `src/app/features/ai/ai.worker.ts`
A dedicated Web Worker that imports Transformers.js, loads the model pipeline, and exposes a `postMessage` API:

```
Input messages:  { type: 'load' | 'generate', payload }
Output messages: { type: 'progress' | 'token' | 'done' | 'error', payload }
```

Running inference off the main thread prevents UI freezes during generation.

---

### 4. Create AI Context Service — `src/app/core/services/ai-context.service.ts`
Subscribes to `FinancialEngineService` streams and `CreditCardService`, then serializes all data into a compact system-prompt string:
- Monthly income totals by source
- Expense totals by category
- Installment statuses
- Credit card utilization
- Balance trend for last 6 months

This snapshot is prepended to every conversation as the AI's "knowledge".

---

### 5. Create AI Service — `src/app/core/services/ai.service.ts`
Wraps the Web Worker with:
- `loadModel$` — Observable tracking download progress (0–100%) and loading state
- `generateReply(messages: ChatMessage[])` — streams tokens from the worker and emits them one by one
- `isReady$`, `isGenerating$` signals for UI state

---

### 6. Create AI Feature — `src/app/features/ai/`

**`ai.component.ts`** — standalone Ionic component:
- Injects `AiService` and `AiContextService`
- Manages `messages: ChatMessage[]` array
- On first load shows a download/setup screen with `ion-progress-bar`
- During generation, streams tokens into the last message in real time

**`ai.component.html`** — chat layout:
- `ion-content` with a scrollable message list (user bubbles right, AI bubbles left)
- `ion-footer` with `IonInput` + send button (disabled during generation)
- "thinking..." skeleton between send and first token

---

### 7. Register the Route — `src/app/app.routes.ts`
Add inside the tabs children:
```ts
{ path: 'ai', loadComponent: () => import('./features/ai/ai.component').then(m => m.AiComponent) }
```

---

### 8. Add the 5th Tab — `src/app/features/tabs/`
- Modify `tabs.component.html` to add an `ion-tab-button` with a `sparkles` icon and label "AI Assistant" linking to `/tabs/ai`
- Update `tabs.component.ts` imports for the `sparkles` icon

---

### 9. Angular & Capacitor Compatibility Check
- Transformers.js works without `SharedArrayBuffer` — no special WebView headers needed
- The WASM file from the NPM package is bundled by Angular automatically
- Verify `tsconfig.app.json` `"lib"` includes `"WebWorker"` for the worker file; add if missing

---

## Verification Checklist

- [ ] `bun run start` — AI tab appears in bottom nav
- [ ] First open: progress bar shows model download completing
- [ ] After load: ask "What did I spend the most on this month?" — AI responds with actual data
- [ ] Kill internet → reload → AI still works fully offline (model served from cache)
- [ ] Android build: `bun run build && npx cap sync android` — WASM executes in system WebView

---

## Technical Decisions

| Decision | Reason |
|---|---|
| Transformers.js over native Android AI | No Capacitor plugin or native code; pure TypeScript; works all Android versions; cross-platform ready |
| Web Worker for inference | Prevents 2–5s generation blocks from freezing Ionic scroll/tap animations on mobile |
| Qwen2.5-0.5B INT4 as default | Best quality-per-MB under 500MB; understands structured financial context despite being tiny |
| Streaming tokens | Better UX on mobile — user sees partial answers immediately rather than waiting 10–30s |

---

## Notes / Tweaks to Revisit
- [ ] Consider system prompt length limits if user has many months of data
- [ ] Add a "Clear chat" button to reset conversation history
- [ ] Option to let user pick a different model from settings
- [ ] Rate-limit context snapshot updates (don't re-serialize on every message)
