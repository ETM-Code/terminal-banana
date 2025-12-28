/**
 * Alpha channel extraction using difference matting technique
 */

import sharp from 'sharp';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join, resolve, basename } from 'path';
import { generateImage, editImage, Model, ImageConfig } from './gemini.js';
import {
  appendWhiteBackground,
  EDIT_TO_BLACK_PROMPT,
  REMOVE_BG_TO_WHITE_PROMPT,
  REMOVE_BG_TO_BLACK_PROMPT,
} from './prompts.js';
import { ImageType, ensureDir, wrapPromptForType } from './utils.js';

export type TransparentMethod = 'pro-pro' | 'pro-flash' | 'flash-flash' | 'local';

export { ImageType };

function getModelsForMethod(method: TransparentMethod): { generate: Model; edit: Model } {
  switch (method) {
    case 'pro-pro':
      return { generate: 'nano-banana-pro', edit: 'nano-banana-pro' };
    case 'pro-flash':
      return { generate: 'nano-banana-pro', edit: 'nano-banana' };
    case 'flash-flash':
      return { generate: 'nano-banana', edit: 'nano-banana' };
    case 'local':
      // Local method doesn't use API, but return defaults for type safety
      return { generate: 'nano-banana', edit: 'nano-banana' };
  }
}

export type BackgroundColor = 'white' | 'black' | 'auto' | string; // string for hex like '#00ff00'

function parseColor(color: string): { r: number; g: number; b: number } {
  if (color === 'white') return { r: 255, g: 255, b: 255 };
  if (color === 'black') return { r: 0, g: 0, b: 0 };
  // Parse hex color
  const hex = color.replace('#', '');
  if (!/^[0-9a-fA-F]{6}$/.test(hex)) {
    throw new Error(`Invalid hex color: ${color}. Use format #RRGGBB or RRGGBB`);
  }
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  return { r, g, b };
}

/**
 * Local background removal using color similarity
 * No API calls - works well for solid color backgrounds
 */
export async function removeBackgroundLocal(
  inputPath: string,
  outputPath: string,
  options: {
    bgColor?: BackgroundColor;
    tolerance?: number; // 0-255, default 30
  } = {}
): Promise<void> {
  const tolerance = options.tolerance ?? 30;
  const toleranceSquared = tolerance * tolerance;
  const doubleToleranceSquared = (tolerance * 2) * (tolerance * 2);

  const { data, info } = await sharp(inputPath)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  // Auto-detect background color from corners if not specified
  let bgColor: { r: number; g: number; b: number };
  if (!options.bgColor || options.bgColor === 'auto') {
    // Sample corners to detect background
    const corners = [
      0, // top-left
      (info.width - 1) * 4, // top-right
      (info.height - 1) * info.width * 4, // bottom-left
      ((info.height - 1) * info.width + (info.width - 1)) * 4, // bottom-right
    ];
    let rSum = 0, gSum = 0, bSum = 0;
    for (const offset of corners) {
      rSum += data[offset];
      gSum += data[offset + 1];
      bSum += data[offset + 2];
    }
    bgColor = {
      r: Math.round(rSum / 4),
      g: Math.round(gSum / 4),
      b: Math.round(bSum / 4),
    };
  } else {
    bgColor = parseColor(options.bgColor);
  }

  // Mutate buffer in-place since we own it
  const pixelCount = info.width * info.height;
  for (let i = 0; i < pixelCount; i++) {
    const offset = i * 4;
    const r = data[offset];
    const g = data[offset + 1];
    const b = data[offset + 2];

    // Calculate squared color distance from background (avoid sqrt for threshold checks)
    const dr = r - bgColor.r;
    const dg = g - bgColor.g;
    const db = b - bgColor.b;
    const distSquared = dr * dr + dg * dg + db * db;

    // Calculate alpha based on distance from background color
    // Pixels similar to background become transparent
    let alpha: number;
    if (distSquared <= toleranceSquared) {
      alpha = 0; // Fully transparent
    } else if (distSquared <= doubleToleranceSquared) {
      // Gradual fade for anti-aliasing - need actual distance here
      const dist = Math.sqrt(distSquared);
      alpha = (dist - tolerance) / tolerance;
    } else {
      alpha = 1; // Fully opaque
    }

    // RGB stays the same, just update alpha
    data[offset + 3] = Math.round(alpha * 255);
  }

  await sharp(data, {
    raw: { width: info.width, height: info.height, channels: 4 },
  })
    .png()
    .toFile(outputPath);
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

  const pixelCount = meta.width * meta.height;
  for (let i = 0; i < pixelCount; i++) {
    const offset = i * 4;

    // Get RGB values for the same pixel in both images
    const rW = dataWhite[offset];
    const gW = dataWhite[offset + 1];
    const bW = dataWhite[offset + 2];

    const rB = dataBlack[offset];
    const gB = dataBlack[offset + 1];
    const bB = dataBlack[offset + 2];

    // Calculate the distance between the two observed pixels
    const drWB = rW - rB;
    const dgWB = gW - gB;
    const dbWB = bW - bB;
    const pixelDist = Math.sqrt(drWB * drWB + dgWB * dgWB + dbWB * dbWB);

    // If the pixel is 100% opaque, it looks the same on Black and White (pixelDist = 0).
    // If the pixel is 100% transparent, it looks exactly like the backgrounds (pixelDist = bgDist).
    let alpha = 1 - pixelDist / bgDist;

    // Clamp results to 0-1 range
    if (alpha < 0) alpha = 0;
    if (alpha > 1) alpha = 1;

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

export interface LocalTransparencyResult {
  path: string;
  method: 'local';
  input: string;
  bgColor: string;
  tolerance: number;
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
    bgColor?: BackgroundColor;
    tolerance?: number;
  } = {}
): Promise<ExtractTransparencyResult | LocalTransparencyResult> {
  const method = options.method || 'pro-pro';

  if (!existsSync(inputPath)) {
    throw new Error(`Input file not found: ${inputPath}`);
  }

  ensureDir(outputDir);

  // Handle local method (no API calls)
  if (method === 'local') {
    const timestamp = Date.now();
    const inputName = basename(inputPath, '.png').replace(/\.[^.]+$/, '');
    const filename = options.filename || `${inputName}_transparent_${timestamp}.png`;
    const outputPath = resolve(join(outputDir, filename));

    const bgColor = options.bgColor || 'auto';
    const tolerance = options.tolerance ?? 30;

    await removeBackgroundLocal(inputPath, outputPath, { bgColor, tolerance });

    return {
      path: outputPath,
      method: 'local',
      input: resolve(inputPath),
      bgColor: bgColor,
      tolerance,
    };
  }

  // API-based methods
  const { edit: editModel } = getModelsForMethod(method);
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
