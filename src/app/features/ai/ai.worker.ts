/**
 * AI Web Worker — runs Transformers.js inference off the main thread.
 *
 * Protocol:
 *   Main → Worker:
 *     { type: 'load' }
 *     { type: 'generate', payload: { messages: { role: string; content: string }[] } }
 *     { type: 'abort' }
 *
 *   Worker → Main:
 *     { type: 'progress', payload: { status: string; progress?: number; file?: string } }
 *     { type: 'ready',    payload: { device: string } }
 *     { type: 'token',    payload: string }
 *     { type: 'done',     payload: string }
 *     { type: 'error',    payload: string }
 */

/// <reference lib="webworker" />

import { pipeline, env, TextStreamer } from '@huggingface/transformers';

env.allowLocalModels = false;

const MODEL_ID = 'HuggingFaceTB/SmolLM2-1.7B-Instruct';

let generator: any = null;
let abortController: AbortController | null = null;
let activeDevice = 'wasm';

addEventListener('message', async (e: MessageEvent) => {
  const { type, payload } = e.data;

  if (type === 'load') {
    await loadModel();
  } else if (type === 'generate') {
    await generate(payload.messages);
  } else if (type === 'abort') {
    abortController?.abort();
  }
});

/* ───── helpers ───── */

function hasWebGPU(): boolean {
  return typeof navigator !== 'undefined' && !!(navigator as any).gpu;
}

function progressCb(progress: any): void {
  postMessage({
    type: 'progress',
    payload: {
      status: progress.status ?? 'loading',
      progress: progress.progress ?? undefined,
      file: progress.file ?? undefined,
    },
  });
}

/** Guard against garbled output (common with wrong dtype/backend combo). */
function isValidText(text: string): boolean {
  // If >40% of characters are non-Latin / non-common-punctuation, it's likely garbled
  const valid = text.replace(/[^\x20-\x7E\n\r\t]/g, '');
  return valid.length > text.length * 0.5;
}

/* ───── load ───── */

async function loadModel(): Promise<void> {
  // Try WebGPU first (10-100× faster), fall back to WASM
  // IMPORTANT: q4f16 only works on WebGPU (fp16 compute). WASM needs q4 (fp32 compute).
  const attempts: { device: string; dtype: string }[] = hasWebGPU()
    ? [
        { device: 'webgpu', dtype: 'q4f16' },
        { device: 'wasm', dtype: 'q4' },
      ]
    : [{ device: 'wasm', dtype: 'q4' }];

  for (const { device, dtype } of attempts) {
    try {
      generator = await (pipeline as any)('text-generation', MODEL_ID, {
        dtype,
        device,
        progress_callback: progressCb,
      });
      activeDevice = device;
      postMessage({ type: 'ready', payload: { device } });
      return;
    } catch (err: any) {
      console.warn(`[ai-worker] ${device} failed:`, err?.message);
      // continue to next attempt
    }
  }

  postMessage({ type: 'error', payload: 'Could not load model on any backend.' });
}

/* ───── generate ───── */

async function generate(messages: { role: string; content: string }[]): Promise<void> {
  if (!generator) {
    postMessage({ type: 'error', payload: 'Model not loaded yet.' });
    return;
  }

  abortController = new AbortController();

  try {
    let fullText = '';

    // Token-by-token streaming via TextStreamer
    const streamer = new (TextStreamer as any)(generator.tokenizer, {
      skip_prompt: true,
      skip_special_tokens: true,
      callback_function: (token: string) => {
        if (token && isValidText(token)) {
          fullText += token;
          postMessage({ type: 'token', payload: token });
        }
      },
    });

    const output = await generator(messages as any, {
      max_new_tokens: 512,
      temperature: 0.3,
      top_p: 0.9,
      do_sample: true,
      repetition_penalty: 1.2,
      return_full_text: false,
      streamer,
    } as any);

    // Fallback: if streaming produced nothing, extract from output directly
    if (!fullText && output) {
      const result = Array.isArray(output) ? output[0] : output;
      const generated = (result as any)?.generated_text;
      if (typeof generated === 'string') {
        fullText = generated;
      } else if (Array.isArray(generated)) {
        const last = generated[generated.length - 1];
        fullText = last?.content ?? '';
      }
      if (fullText) {
        postMessage({ type: 'token', payload: fullText });
      }
    }

    postMessage({ type: 'done', payload: fullText });
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      postMessage({ type: 'done', payload: '[aborted]' });
    } else {
      console.error('[ai-worker] generate error:', err);
      postMessage({ type: 'error', payload: err?.message ?? String(err) });
    }
  } finally {
    abortController = null;
  }
}
