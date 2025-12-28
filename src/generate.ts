/**
 * Image generation and editing operations
 */

import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join, resolve, basename } from 'path';
import { generateImage, editImage, Model, ImageConfig } from './gemini.js';
import { ImageType, ensureDir, wrapPromptForType, generateFilename } from './utils.js';

export { ImageType };

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
