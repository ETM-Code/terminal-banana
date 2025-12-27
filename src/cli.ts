#!/usr/bin/env node

/**
 * terminal-banana CLI - Image generation using Nano Banana (Gemini Image) APIs
 */

import {
  loadConfig,
  saveConfig,
  clearConfig,
  getConfigPath,
  maskApiKey,
  promptForApiKey,
} from './config.js';
import { generate, edit, loadReferenceImages } from './generate.js';
import {
  generateWithTransparency,
  extractTransparencyFromImage,
  TransparentMethod,
  ImageType,
} from './alpha.js';
import { Model, AspectRatio, ImageSize, ImageConfig } from './gemini.js';

function printJson(data: unknown): void {
  console.log(JSON.stringify(data, null, 2));
}

function printError(message: string): never {
  console.error(JSON.stringify({ error: message }));
  process.exit(1);
}

function usage(): void {
  console.log(`terminal-banana - Image generation using Nano Banana (Gemini Image) APIs

Usage:
  Config:
    terminal-banana config set-key              Set API key (prompts for hidden input)
    terminal-banana config show                 Show config (key partially masked)
    terminal-banana config clear                Remove API key
    terminal-banana config path                 Print config file path

  Generate:
    terminal-banana generate -o <dir> "<prompt>"     Generate an image
    terminal-banana icon -o <dir> "<prompt>"         Generate a minimalist icon
    terminal-banana logo -o <dir> "<prompt>"         Generate a logo
    terminal-banana ui -o <dir> "<prompt>"           Generate a UI concept

  Edit:
    terminal-banana edit -o <dir> -i <image> "<prompt>"
                                                Edit an existing image

  Transparent (with alpha channel):
    terminal-banana transparent -o <dir> "<prompt>" [--method pro-pro|pro-flash|flash-flash]
    terminal-banana transparent-icon -o <dir> "<prompt>" [--method ...]
    terminal-banana transparent-logo -o <dir> "<prompt>" [--method ...]
    terminal-banana transparent-ui -o <dir> "<prompt>" [--method ...]

  Background Removal:
    terminal-banana edit-transparent -o <dir> -i <image> [--method ...]
                                                Remove background from existing image

Options:
  -o <dir>              Output directory (required for all generation commands)
  -i <image>            Input image path (required for edit commands)
  -r <image>            Reference image (can be used multiple times, up to 14 for pro)
  --method <m>          Transparency method: pro-pro (default), pro-flash, flash-flash
  --model <m>           Model: nano-banana-pro (default), nano-banana
  --resolution <r>      Image size: 1K (default), 2K, 4K (pro only)
  --aspect-ratio <ar>   Aspect ratio: 1:1 (default), 16:9, 9:16, 4:3, 3:4, etc.

Output: JSON for easy parsing`);
}

interface ParsedArgs {
  outputDir?: string;
  inputImage?: string;
  prompt?: string;
  method?: TransparentMethod;
  model?: Model;
  resolution?: ImageSize;
  aspectRatio?: AspectRatio;
  referenceImages?: string[];
}

const VALID_ASPECT_RATIOS: AspectRatio[] = ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'];
const VALID_RESOLUTIONS: ImageSize[] = ['1K', '2K', '4K'];

function parseArgs(args: string[]): ParsedArgs {
  const result: ParsedArgs = {};
  const promptParts: string[] = [];
  const refImages: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '-o' && args[i + 1]) {
      result.outputDir = args[++i];
    } else if (arg === '-i' && args[i + 1]) {
      result.inputImage = args[++i];
    } else if (arg === '-r' && args[i + 1]) {
      refImages.push(args[++i]);
    } else if (arg === '--method' && args[i + 1]) {
      const method = args[++i];
      if (method === 'pro-pro' || method === 'pro-flash' || method === 'flash-flash') {
        result.method = method;
      }
    } else if (arg === '--model' && args[i + 1]) {
      const model = args[++i];
      if (model === 'nano-banana' || model === 'nano-banana-pro') {
        result.model = model;
      }
    } else if (arg === '--resolution' && args[i + 1]) {
      const res = args[++i] as ImageSize;
      if (VALID_RESOLUTIONS.includes(res)) {
        result.resolution = res;
      }
    } else if (arg === '--aspect-ratio' && args[i + 1]) {
      const ar = args[++i] as AspectRatio;
      if (VALID_ASPECT_RATIOS.includes(ar)) {
        result.aspectRatio = ar;
      }
    } else if (!arg.startsWith('-')) {
      promptParts.push(arg);
    }
  }

  if (promptParts.length > 0) {
    result.prompt = promptParts.join(' ');
  }

  if (refImages.length > 0) {
    result.referenceImages = refImages;
  }

  return result;
}

function buildImageConfig(parsed: ParsedArgs): ImageConfig | undefined {
  if (!parsed.resolution && !parsed.aspectRatio) {
    return undefined;
  }
  return {
    imageSize: parsed.resolution,
    aspectRatio: parsed.aspectRatio,
  };
}

function requireOutputDir(parsed: ParsedArgs): string {
  if (!parsed.outputDir) {
    printError('Output directory required. Use -o <dir>');
  }
  return parsed.outputDir;
}

function requirePrompt(parsed: ParsedArgs): string {
  if (!parsed.prompt) {
    printError('Prompt required');
  }
  return parsed.prompt;
}

function requireInputImage(parsed: ParsedArgs): string {
  if (!parsed.inputImage) {
    printError('Input image required. Use -i <image>');
  }
  return parsed.inputImage;
}

async function handleConfig(subcommand: string): Promise<void> {
  switch (subcommand) {
    case 'set-key': {
      const apiKey = await promptForApiKey();
      if (!apiKey.trim()) {
        printError('API key cannot be empty');
      }
      saveConfig({ apiKey: apiKey.trim() });
      printJson({ success: true, message: 'API key saved' });
      break;
    }

    case 'show': {
      const config = loadConfig();
      if (!config) {
        printJson({ configured: false });
      } else {
        printJson({
          configured: true,
          apiKey: maskApiKey(config.apiKey),
        });
      }
      break;
    }

    case 'clear': {
      const cleared = clearConfig();
      printJson({ success: cleared, message: cleared ? 'Config cleared' : 'No config to clear' });
      break;
    }

    case 'path': {
      printJson({ path: getConfigPath() });
      break;
    }

    default:
      printError(`Unknown config subcommand: ${subcommand}. Use set-key, show, clear, or path`);
  }
}

async function handleGenerate(
  args: string[],
  type: ImageType
): Promise<void> {
  const parsed = parseArgs(args);
  const outputDir = requireOutputDir(parsed);
  const prompt = requirePrompt(parsed);

  // Load reference images if provided
  const referenceImages = parsed.referenceImages
    ? loadReferenceImages(parsed.referenceImages)
    : undefined;

  const result = await generate(prompt, outputDir, {
    model: parsed.model,
    type,
    imageConfig: buildImageConfig(parsed),
    referenceImages,
  });

  printJson(result);
}

async function handleEdit(args: string[]): Promise<void> {
  const parsed = parseArgs(args);
  const outputDir = requireOutputDir(parsed);
  const inputImage = requireInputImage(parsed);
  const prompt = requirePrompt(parsed);

  const result = await edit(inputImage, prompt, outputDir, {
    model: parsed.model,
    imageConfig: buildImageConfig(parsed),
  });

  printJson(result);
}

async function handleTransparent(
  args: string[],
  type: ImageType
): Promise<void> {
  const parsed = parseArgs(args);
  const outputDir = requireOutputDir(parsed);
  const prompt = requirePrompt(parsed);

  const result = await generateWithTransparency(prompt, outputDir, {
    method: parsed.method,
    type,
    imageConfig: buildImageConfig(parsed),
  });

  printJson(result);
}

async function handleEditTransparent(args: string[]): Promise<void> {
  const parsed = parseArgs(args);
  const outputDir = requireOutputDir(parsed);
  const inputImage = requireInputImage(parsed);

  const result = await extractTransparencyFromImage(inputImage, outputDir, {
    method: parsed.method,
    imageConfig: buildImageConfig(parsed),
  });

  printJson(result);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    usage();
    process.exit(0);
  }

  const command = args[0];
  const restArgs = args.slice(1);

  try {
    switch (command) {
      case 'config': {
        if (!restArgs[0]) {
          printError('Config subcommand required: set-key, show, clear, or path');
        }
        await handleConfig(restArgs[0]);
        break;
      }

      case 'generate':
        await handleGenerate(restArgs, 'image');
        break;

      case 'icon':
        await handleGenerate(restArgs, 'icon');
        break;

      case 'logo':
        await handleGenerate(restArgs, 'logo');
        break;

      case 'ui':
        await handleGenerate(restArgs, 'ui');
        break;

      case 'edit':
        await handleEdit(restArgs);
        break;

      case 'transparent':
        await handleTransparent(restArgs, 'image');
        break;

      case 'transparent-icon':
        await handleTransparent(restArgs, 'icon');
        break;

      case 'transparent-logo':
        await handleTransparent(restArgs, 'logo');
        break;

      case 'transparent-ui':
        await handleTransparent(restArgs, 'ui');
        break;

      case 'edit-transparent':
        await handleEditTransparent(restArgs);
        break;

      default:
        printError(`Unknown command: ${command}. Use --help for usage.`);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    printError(message);
  }
}

main();
