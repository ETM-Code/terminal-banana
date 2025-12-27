/**
 * Config management - API key storage and retrieval
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';
import * as readline from 'readline';

export interface Config {
  apiKey: string;
}

const CONFIG_DIR = join(homedir(), '.config', 'terminal-banana');
const CONFIG_PATH = join(CONFIG_DIR, 'config.json');

export function getConfigPath(): string {
  return CONFIG_PATH;
}

export function loadConfig(): Config | null {
  if (!existsSync(CONFIG_PATH)) {
    return null;
  }
  try {
    const data = readFileSync(CONFIG_PATH, 'utf-8');
    return JSON.parse(data) as Config;
  } catch {
    return null;
  }
}

export function saveConfig(config: Config): void {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

export function clearConfig(): boolean {
  if (!existsSync(CONFIG_PATH)) {
    return false;
  }
  unlinkSync(CONFIG_PATH);
  return true;
}

export function getApiKey(): string {
  const config = loadConfig();
  if (!config || !config.apiKey) {
    throw new Error('API key not configured. Run: terminal-banana config set-key');
  }
  return config.apiKey;
}

export function maskApiKey(key: string): string {
  if (key.length <= 8) {
    return '****';
  }
  return key.slice(0, 4) + '...' + key.slice(-4);
}

export async function promptForApiKey(): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    // Hide input for password-like entry
    process.stdout.write('Enter your Gemini API key: ');

    let input = '';

    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');

    const onData = (char: string) => {
      if (char === '\n' || char === '\r') {
        process.stdin.setRawMode(false);
        process.stdin.removeListener('data', onData);
        process.stdout.write('\n');
        rl.close();
        resolve(input);
      } else if (char === '\u0003') {
        // Ctrl+C
        process.exit(1);
      } else if (char === '\u007F' || char === '\b') {
        // Backspace
        if (input.length > 0) {
          input = input.slice(0, -1);
          process.stdout.clearLine(0);
          process.stdout.cursorTo(0);
          process.stdout.write('Enter your Gemini API key: ' + '*'.repeat(input.length));
        }
      } else {
        input += char;
        process.stdout.write('*');
      }
    };

    process.stdin.on('data', onData);
  });
}
