/**
 * Alpha channel extraction using difference matting technique
 */

import sharp from 'sharp';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join, resolve, basename } from 'path';
import { generateImage, editImage, Model, ImageConfig } from './gemini.js';
import {
  appendWhiteBackground,
  EDIT_TO_BLACK_PROMPT,
  REMOVE_BG_TO_WHITE_PROMPT,
  REMOVE_BG_TO_BLACK_PROMPT,
  wrapIconPrompt,
  wrapLogoPrompt,
  wrapUIPrompt,
} from './prompts.js';

export type TransparentMethod = 'pro-pro' | 'pro-flash' | 'flash-flash';

export type ImageType = 'image' | 'icon' | 'logo' | 'ui';

function ensureDir(dir: string): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

function getModelsForMethod(method: TransparentMethod): { generate: Model; edit: Model } {
  switch (method) {
    case 'pro-pro':
      return { generate: 'nano-banana-pro', edit: 'nano-banana-pro' };
    case 'pro-flash':
      return { generate: 'nano-banana-pro', edit: 'nano-banana' };
    case 'flash-flash':
      return { generate: 'nano-banana', edit: 'nano-banana' };
  }
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

/**
 * Core difference matting algorithm
 * Compares same image on white vs black background to extract alpha channel
 */
export async function extractAlphaTwoPass(
  imgOnWhitePath: string,
  imgOnBlackPath: string,
  outputPath: string
): Promise<void> {
  const img1 = sharp(imgOnWhitePath);
  const img2 = sharp(imgOnBlackPath);

  const { data: dataWhite, info: meta } = await img1
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { data: dataBlack } = await img2
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  if (dataWhite.length !== dataBlack.length) {
    throw new Error('Dimension mismatch: Images must be identical size');
  }

  const outputBuffer = Buffer.alloc(dataWhite.length);

  // Distance between White (255,255,255) and Black (0,0,0)
  // sqrt(255^2 + 255^2 + 255^2) ≈ 441.67
  const bgDist = Math.sqrt(3 * 255 * 255);

  for (let i = 0; i < meta.width * meta.height; i++) {
    const offset = i * 4;

    // Get RGB values for the same pixel in both images
    const rW = dataWhite[offset];
    const gW = dataWhite[offset + 1];
    const bW = dataWhite[offset + 2];

    const rB = dataBlack[offset];
    const gB = dataBlack[offset + 1];
    const bB = dataBlack[offset + 2];

    // Calculate the distance between the two observed pixels
    const pixelDist = Math.sqrt(
      Math.pow(rW - rB, 2) + Math.pow(gW - gB, 2) + Math.pow(bW - bB, 2)
    );

    // If the pixel is 100% opaque, it looks the same on Black and White (pixelDist = 0).
    // If the pixel is 100% transparent, it looks exactly like the backgrounds (pixelDist = bgDist).
    let alpha = 1 - pixelDist / bgDist;

    // Clamp results to 0-1 range
    alpha = Math.max(0, Math.min(1, alpha));

    // Color Recovery:
    // Use the image on black to recover the color, dividing by alpha
    // to un-premultiply it (brighten the semi-transparent pixels)
    let rOut = 0,
      gOut = 0,
      bOut = 0;

    if (alpha > 0.01) {
      // Recover foreground color from the version on black
      // Since BG is black (0,0,0), this simplifies to C / alpha
      rOut = rB / alpha;
      gOut = gB / alpha;
      bOut = bB / alpha;
    }

    outputBuffer[offset] = Math.round(Math.min(255, rOut));
    outputBuffer[offset + 1] = Math.round(Math.min(255, gOut));
    outputBuffer[offset + 2] = Math.round(Math.min(255, bOut));
    outputBuffer[offset + 3] = Math.round(alpha * 255);
  }

  await sharp(outputBuffer, {
    raw: { width: meta.width, height: meta.height, channels: 4 },
  })
    .png()
    .toFile(outputPath);
}

export interface TransparentResult {
  path: string;
  intermediates: {
    white: string;
    black: string;
  };
  method: TransparentMethod;
  prompt: string;
}

/**
 * Generate an image with transparency using the two-pass method
 */
export async function generateWithTransparency(
  prompt: string,
  outputDir: string,
  options: {
    method?: TransparentMethod;
    filename?: string;
    type?: ImageType;
    imageConfig?: ImageConfig;
  } = {}
): Promise<TransparentResult> {
  const method = options.method || 'pro-pro';
  const { generate: genModel, edit: editModel } = getModelsForMethod(method);
  const type = options.type || 'image';

  ensureDir(outputDir);

  // Wrap prompt for type and append white background
  const wrappedPrompt = wrapPromptForType(prompt, type);
  const whitePrompt = appendWhiteBackground(wrappedPrompt);

  // Step 1: Generate on white background
  const whiteBuffer = await generateImage(whitePrompt, genModel, options.imageConfig);
  const timestamp = Date.now();
  const whitePath = resolve(join(outputDir, `_white_${timestamp}.png`));
  writeFileSync(whitePath, whiteBuffer);

  // Step 2: Edit to black background
  const blackBuffer = await editImage(whiteBuffer, EDIT_TO_BLACK_PROMPT, editModel, options.imageConfig);
  const blackPath = resolve(join(outputDir, `_black_${timestamp}.png`));
  writeFileSync(blackPath, blackBuffer);

  // Step 3: Extract alpha
  const filename = options.filename || `transparent_${type}_${timestamp}.png`;
  const outputPath = resolve(join(outputDir, filename));
  await extractAlphaTwoPass(whitePath, blackPath, outputPath);

  return {
    path: outputPath,
    intermediates: {
      white: whitePath,
      black: blackPath,
    },
    method,
    prompt: wrappedPrompt,
  };
}

export interface ExtractTransparencyResult {
  path: string;
  intermediates: {
    white: string;
    black: string;
  };
  method: TransparentMethod;
  input: string;
}

/**
 * Extract transparency from an existing image (background removal)
 */
export async function extractTransparencyFromImage(
  inputPath: string,
  outputDir: string,
  options: {
    method?: TransparentMethod;
    filename?: string;
    imageConfig?: ImageConfig;
  } = {}
): Promise<ExtractTransparencyResult> {
  const method = options.method || 'pro-pro';
  const { edit: editModel } = getModelsForMethod(method);

  if (!existsSync(inputPath)) {
    throw new Error(`Input file not found: ${inputPath}`);
  }

  ensureDir(outputDir);

  const inputBuffer = readFileSync(inputPath);
  const timestamp = Date.now();

  // Step 1: Edit to white background
  const whiteBuffer = await editImage(inputBuffer, REMOVE_BG_TO_WHITE_PROMPT, editModel, options.imageConfig);
  const whitePath = resolve(join(outputDir, `_white_${timestamp}.png`));
  writeFileSync(whitePath, whiteBuffer);

  // Step 2: Edit original to black background
  const blackBuffer = await editImage(inputBuffer, REMOVE_BG_TO_BLACK_PROMPT, editModel, options.imageConfig);
  const blackPath = resolve(join(outputDir, `_black_${timestamp}.png`));
  writeFileSync(blackPath, blackBuffer);

  // Step 3: Extract alpha
  const inputName = basename(inputPath, '.png').replace(/\.[^.]+$/, '');
  const filename = options.filename || `${inputName}_transparent_${timestamp}.png`;
  const outputPath = resolve(join(outputDir, filename));
  await extractAlphaTwoPass(whitePath, blackPath, outputPath);

  return {
    path: outputPath,
    intermediates: {
      white: whitePath,
      black: blackPath,
    },
    method,
    input: resolve(inputPath),
  };
}
