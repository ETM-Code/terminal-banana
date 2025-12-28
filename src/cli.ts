#!/usr/bin/env node

/**
 * terminal-banana CLI - Image generation using Nano Banana (Gemini Image) APIs
 */

import { execFile } from 'child_process';
import { platform } from 'os';
import { basename } from 'path';
import * as readline from 'readline';
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
  BackgroundColor,
} from './alpha.js';
import { Model, AspectRatio, ImageSize, ImageConfig } from './gemini.js';

function printJson(data: unknown): void {
  console.log(JSON.stringify(data, null, 2));
}

function openFile(filePath: string): void {
  const plat = platform();
  if (plat === 'darwin') {
    execFile('open', [filePath]);
  } else if (plat === 'win32') {
    execFile('cmd', ['/c', 'start', '', filePath]);
  } else {
    execFile('xdg-open', [filePath]);
  }
}

// Estimated costs per image (approximate, based on public pricing)
const COST_ESTIMATES = {
  'nano-banana': { generation: 0.02, edit: 0.02 },      // Flash ~$0.02/image
  'nano-banana-pro': { generation: 0.05, edit: 0.05 }, // Pro ~$0.05/image
};

interface CostEstimate {
  model: string;
  operations: string[];
  estimatedCost: string;
  note: string;
}

function estimateCost(
  model: Model,
  operations: ('generation' | 'edit')[]
): CostEstimate {
  const costs = COST_ESTIMATES[model];
  let total = 0;
  for (const op of operations) {
    total += costs[op];
  }
  return {
    model,
    operations,
    estimatedCost: `~$${total.toFixed(3)}`,
    note: 'Estimates based on public pricing. Actual costs may vary.',
  };
}

async function confirmCost(estimate: CostEstimate): Promise<boolean> {
  console.log(JSON.stringify(estimate, null, 2));

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question('Proceed? (y/n): ', (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes');
    });
  });
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
  --method <m>          Transparency method: pro-pro (default), pro-flash, flash-flash, local
  --model <m>           Model: nano-banana-pro (default), nano-banana
  --resolution <r>      Image size: 1K (default), 2K, 4K (pro only)
  --aspect-ratio <ar>   Aspect ratio: 1:1 (default), 16:9, 9:16, 4:3, 3:4, etc.
  --bg-color <c>        Background color for local method: white, black, auto, #hex (default: auto)
  --tolerance <n>       Color tolerance for local method: 0-255 (default: 30)
  --name <filename>     Custom output filename (without extension)
  --open                Open generated image in default viewer
  --cost                Show estimated cost before generating (requires confirmation)

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
  bgColor?: BackgroundColor;
  tolerance?: number;
  name?: string;
  open?: boolean;
  showCost?: boolean;
}

const VALID_ASPECT_RATIOS: AspectRatio[] = ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'];
const VALID_RESOLUTIONS: ImageSize[] = ['1K', '2K', '4K'];

const VALID_FLAGS = new Set([
  '-o', '-i', '-r', '--method', '--bg-color', '--tolerance',
  '--model', '--resolution', '--aspect-ratio', '--name', '--open', '--cost'
]);

const MAX_REFERENCE_IMAGES = 14;

function parseArgs(args: string[]): ParsedArgs {
  const result: ParsedArgs = {};
  const promptParts: string[] = [];
  const refImages: string[] = [];
  const unknownFlags: string[] = [];

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
      if (method === 'pro-pro' || method === 'pro-flash' || method === 'flash-flash' || method === 'local') {
        result.method = method;
      } else {
        printError(`Invalid method: ${method}. Valid options: pro-pro, pro-flash, flash-flash, local`);
      }
    } else if (arg === '--bg-color' && args[i + 1]) {
      result.bgColor = args[++i] as BackgroundColor;
    } else if (arg === '--tolerance' && args[i + 1]) {
      const tol = parseInt(args[++i], 10);
      if (isNaN(tol) || tol < 0 || tol > 255) {
        printError(`Invalid tolerance: must be 0-255`);
      }
      result.tolerance = tol;
    } else if (arg === '--model' && args[i + 1]) {
      const model = args[++i];
      if (model === 'nano-banana' || model === 'nano-banana-pro') {
        result.model = model;
      } else {
        printError(`Invalid model: ${model}. Valid options: nano-banana, nano-banana-pro`);
      }
    } else if (arg === '--resolution' && args[i + 1]) {
      const res = args[++i] as ImageSize;
      if (VALID_RESOLUTIONS.includes(res)) {
        result.resolution = res;
      } else {
        printError(`Invalid resolution: ${res}. Valid options: ${VALID_RESOLUTIONS.join(', ')}`);
      }
    } else if (arg === '--aspect-ratio' && args[i + 1]) {
      const ar = args[++i] as AspectRatio;
      if (VALID_ASPECT_RATIOS.includes(ar)) {
        result.aspectRatio = ar;
      } else {
        printError(`Invalid aspect ratio: ${ar}. Valid options: ${VALID_ASPECT_RATIOS.join(', ')}`);
      }
    } else if (arg === '--name' && args[i + 1]) {
      // Sanitize filename to prevent directory traversal
      result.name = basename(args[++i]);
    } else if (arg === '--open') {
      result.open = true;
    } else if (arg === '--cost') {
      result.showCost = true;
    } else if (arg.startsWith('-')) {
      // Unknown flag
      unknownFlags.push(arg);
    } else {
      promptParts.push(arg);
    }
  }

  // Warn about unknown flags
  if (unknownFlags.length > 0) {
    printError(`Unknown flag(s): ${unknownFlags.join(', ')}. Use --help for usage.`);
  }

  if (promptParts.length > 0) {
    result.prompt = promptParts.join(' ');
  }

  if (refImages.length > 0) {
    if (refImages.length > MAX_REFERENCE_IMAGES) {
      printError(`Too many reference images: ${refImages.length}. Maximum is ${MAX_REFERENCE_IMAGES}`);
    }
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
  const model = parsed.model || 'nano-banana-pro';

  // Cost estimation
  if (parsed.showCost) {
    const estimate = estimateCost(model, ['generation']);
    const confirmed = await confirmCost(estimate);
    if (!confirmed) {
      printJson({ cancelled: true });
      return;
    }
  }

  // Load reference images if provided
  const referenceImages = parsed.referenceImages
    ? loadReferenceImages(parsed.referenceImages)
    : undefined;

  const result = await generate(prompt, outputDir, {
    model,
    type,
    imageConfig: buildImageConfig(parsed),
    referenceImages,
    filename: parsed.name ? `${parsed.name}.png` : undefined,
  });

  printJson(result);

  if (parsed.open) {
    openFile(result.path);
  }
}

async function handleEdit(args: string[]): Promise<void> {
  const parsed = parseArgs(args);
  const outputDir = requireOutputDir(parsed);
  const inputImage = requireInputImage(parsed);
  const prompt = requirePrompt(parsed);
  const model = parsed.model || 'nano-banana-pro';

  // Cost estimation
  if (parsed.showCost) {
    const estimate = estimateCost(model, ['edit']);
    const confirmed = await confirmCost(estimate);
    if (!confirmed) {
      printJson({ cancelled: true });
      return;
    }
  }

  const result = await edit(inputImage, prompt, outputDir, {
    model,
    imageConfig: buildImageConfig(parsed),
    filename: parsed.name ? `${parsed.name}.png` : undefined,
  });

  printJson(result);

  if (parsed.open) {
    openFile(result.path);
  }
}

async function handleTransparent(
  args: string[],
  type: ImageType
): Promise<void> {
  const parsed = parseArgs(args);
  const outputDir = requireOutputDir(parsed);
  const prompt = requirePrompt(parsed);
  const method = parsed.method || 'pro-pro';

  // Reject local method for transparent generation - it only works for edit-transparent
  if (method === 'local') {
    printError('--method local is only valid for edit-transparent (background removal from existing images). Use pro-pro, pro-flash, or flash-flash for transparent generation.');
  }

  // Cost estimation (generation + edit for transparency)
  if (parsed.showCost) {
    const genModel = method === 'flash-flash' ? 'nano-banana' : 'nano-banana-pro';
    const editModel = method === 'pro-pro' ? 'nano-banana-pro' : 'nano-banana';
    const genCost = COST_ESTIMATES[genModel].generation;
    const editCost = COST_ESTIMATES[editModel].edit;
    const estimate: CostEstimate = {
      model: `${genModel} (gen) + ${editModel} (edit)`,
      operations: ['generation', 'edit'],
      estimatedCost: `~$${(genCost + editCost).toFixed(3)}`,
      note: 'Estimates based on public pricing. Actual costs may vary.',
    };
    const confirmed = await confirmCost(estimate);
    if (!confirmed) {
      printJson({ cancelled: true });
      return;
    }
  }

  // Load reference images if provided
  const referenceImages = parsed.referenceImages
    ? loadReferenceImages(parsed.referenceImages)
    : undefined;

  const result = await generateWithTransparency(prompt, outputDir, {
    method,
    type,
    imageConfig: buildImageConfig(parsed),
    filename: parsed.name ? `${parsed.name}.png` : undefined,
    referenceImages,
  });

  printJson(result);

  if (parsed.open) {
    openFile(result.path);
  }
}

async function handleEditTransparent(args: string[]): Promise<void> {
  const parsed = parseArgs(args);
  const outputDir = requireOutputDir(parsed);
  const inputImage = requireInputImage(parsed);
  const method = parsed.method || 'pro-pro';

  // Cost estimation (2x edit for API methods, free for local)
  if (parsed.showCost && method !== 'local') {
    const editModel = method === 'pro-pro' ? 'nano-banana-pro' : 'nano-banana';
    const editCost = COST_ESTIMATES[editModel].edit * 2; // Two edits (white + black)
    const estimate: CostEstimate = {
      model: editModel,
      operations: ['edit (to white)', 'edit (to black)'],
      estimatedCost: `~$${editCost.toFixed(3)}`,
      note: 'Estimates based on public pricing. Actual costs may vary.',
    };
    const confirmed = await confirmCost(estimate);
    if (!confirmed) {
      printJson({ cancelled: true });
      return;
    }
  }

  const result = await extractTransparencyFromImage(inputImage, outputDir, {
    method,
    imageConfig: buildImageConfig(parsed),
    bgColor: parsed.bgColor,
    tolerance: parsed.tolerance,
    filename: parsed.name ? `${parsed.name}.png` : undefined,
  });

  printJson(result);

  if (parsed.open) {
    openFile(result.path);
  }
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
