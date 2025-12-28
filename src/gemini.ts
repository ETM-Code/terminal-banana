/**
 * Gemini API wrapper for image generation and editing
 */

import { GoogleGenAI } from '@google/genai';
import { getApiKey } from './config.js';

export type Model = 'nano-banana' | 'nano-banana-pro';
export type AspectRatio = '1:1' | '2:3' | '3:2' | '3:4' | '4:3' | '4:5' | '5:4' | '9:16' | '16:9' | '21:9';
export type ImageSize = '1K' | '2K' | '4K';

const MODELS: Record<Model, string> = {
  'nano-banana': 'gemini-2.5-flash-image',
  'nano-banana-pro': 'gemini-3-pro-image-preview',
};

export interface ImageConfig {
  aspectRatio?: AspectRatio;
  imageSize?: ImageSize;
}

function getClient(): GoogleGenAI {
  const apiKey = getApiKey();
  return new GoogleGenAI({ apiKey });
}

/**
 * Detect image mime type from buffer magic bytes
 */
function detectMimeType(buffer: Buffer): string {
  // Check PNG signature: 89 50 4E 47 0D 0A 1A 0A
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) {
    return 'image/png';
  }
  // Check JPEG signature: FF D8 FF
  if (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) {
    return 'image/jpeg';
  }
  // Check GIF signature: 47 49 46 38
  if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x38) {
    return 'image/gif';
  }
  // Check WebP signature: 52 49 46 46 ... 57 45 42 50
  if (buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46 &&
      buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50) {
    return 'image/webp';
  }
  // Default to PNG if unknown
  return 'image/png';
}

export async function generateImage(
  prompt: string,
  model: Model = 'nano-banana-pro',
  config?: ImageConfig,
  referenceImages?: Buffer[]
): Promise<Buffer> {
  const client = getClient();

  // Build contents array with optional reference images
  const contents: any[] = [];

  // Add reference images first (if any)
  if (referenceImages && referenceImages.length > 0) {
    for (const imgBuffer of referenceImages) {
      contents.push({
        inlineData: {
          mimeType: detectMimeType(imgBuffer),
          data: imgBuffer.toString('base64'),
        },
      });
    }
  }

  // Add the text prompt
  contents.push({ text: prompt });

  const response = await client.models.generateContent({
    model: MODELS[model],
    contents: referenceImages && referenceImages.length > 0 ? contents : prompt,
    config: {
      responseModalities: ['TEXT', 'IMAGE'],
      imageConfig: config ? {
        aspectRatio: config.aspectRatio,
        imageSize: config.imageSize,
      } : undefined,
    },
  });

  for (const part of response.candidates?.[0]?.content?.parts || []) {
    if ((part as any).inlineData) {
      const inlineData = (part as any).inlineData;
      return Buffer.from(inlineData.data, 'base64');
    }
  }

  throw new Error('No image returned from API');
}

export async function editImage(
  imageBuffer: Buffer,
  prompt: string,
  model: Model = 'nano-banana-pro',
  config?: ImageConfig
): Promise<Buffer> {
  const client = getClient();

  const contents = [
    {
      inlineData: {
        mimeType: detectMimeType(imageBuffer),
        data: imageBuffer.toString('base64'),
      },
    },
    { text: prompt },
  ];

  const response = await client.models.generateContent({
    model: MODELS[model],
    contents: contents,
    config: {
      responseModalities: ['TEXT', 'IMAGE'],
      imageConfig: config ? {
        aspectRatio: config.aspectRatio,
        imageSize: config.imageSize,
      } : undefined,
    },
  });

  for (const part of response.candidates?.[0]?.content?.parts || []) {
    if ((part as any).inlineData) {
      const inlineData = (part as any).inlineData;
      return Buffer.from(inlineData.data, 'base64');
    }
  }

  throw new Error('No image returned from API');
}

export function getModelDisplayName(model: Model): string {
  return model;
}
