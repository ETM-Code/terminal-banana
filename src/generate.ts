/**
 * Image generation and editing operations
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join, resolve, basename } from 'path';
import { generateImage, editImage, Model, ImageConfig } from './gemini.js';

export function loadReferenceImages(paths: string[]): Buffer[] {
  const buffers: Buffer[] = [];
  for (const p of paths) {
    if (!existsSync(p)) {
      throw new Error(`Reference image not found: ${p}`);
    }
    buffers.push(readFileSync(p));
  }
  return buffers;
}
import {
  wrapIconPrompt,
  wrapLogoPrompt,
  wrapUIPrompt,
} from './prompts.js';

export type ImageType = 'image' | 'icon' | 'logo' | 'ui';

function ensureDir(dir: string): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

function generateFilename(prefix: string = 'image'): string {
  const timestamp = Date.now();
  return `${prefix}_${timestamp}.png`;
}

function wrapPromptForType(prompt: string, type: ImageType): string {
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

export interface GenerateResult {
  path: string;
  model: string;
  prompt: string;
}

export async function generate(
  prompt: string,
  outputDir: string,
  options: {
    model?: Model;
    filename?: string;
    type?: ImageType;
    imageConfig?: ImageConfig;
    referenceImages?: Buffer[];
  } = {}
): Promise<GenerateResult> {
  const model = options.model || 'nano-banana-pro';
  const type = options.type || 'image';
  const wrappedPrompt = wrapPromptForType(prompt, type);

  ensureDir(outputDir);

  const imageBuffer = await generateImage(wrappedPrompt, model, options.imageConfig, options.referenceImages);

  const filename = options.filename || generateFilename(type);
  const outputPath = resolve(join(outputDir, filename));

  writeFileSync(outputPath, imageBuffer);

  return {
    path: outputPath,
    model,
    prompt: wrappedPrompt,
  };
}

export interface EditResult {
  path: string;
  model: string;
  prompt: string;
  input: string;
}

export async function edit(
  inputPath: string,
  prompt: string,
  outputDir: string,
  options: {
    model?: Model;
    filename?: string;
    imageConfig?: ImageConfig;
  } = {}
): Promise<EditResult> {
  const model = options.model || 'nano-banana-pro';

  if (!existsSync(inputPath)) {
    throw new Error(`Input file not found: ${inputPath}`);
  }

  ensureDir(outputDir);

  const inputBuffer = readFileSync(inputPath);
  const outputBuffer = await editImage(inputBuffer, prompt, model, options.imageConfig);

  const inputName = basename(inputPath, '.png').replace(/\.[^.]+$/, '');
  const filename = options.filename || `${inputName}_edited_${Date.now()}.png`;
  const outputPath = resolve(join(outputDir, filename));

  writeFileSync(outputPath, outputBuffer);

  return {
    path: outputPath,
    model,
    prompt,
    input: resolve(inputPath),
  };
}
