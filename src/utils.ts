/**
 * Shared utility functions
 */

import { existsSync, mkdirSync } from 'fs';
import {
  wrapIconPrompt,
  wrapLogoPrompt,
  wrapUIPrompt,
} from './prompts.js';

export type ImageType = 'image' | 'icon' | 'logo' | 'ui';

export function ensureDir(dir: string): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

export function wrapPromptForType(prompt: string, type: ImageType): string {
  switch (type) {
    case 'icon':
      return wrapIconPrompt(prompt);
    case 'logo':
      return wrapLogoPrompt(prompt);
    case 'ui':
      return wrapUIPrompt(prompt);
    default:
      return prompt;
  }
}

export function generateFilename(prefix: string = 'image'): string {
  const timestamp = Date.now();
  return `${prefix}_${timestamp}.png`;
}
