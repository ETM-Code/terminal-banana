/**
 * Prompt wrappers for specialized image types
 */

export function wrapIconPrompt(userPrompt: string): string {
  return `${userPrompt}. Minimalist icon design, simple shapes, limited colors, no gradients, flat design, suitable for app icon or UI element, clean edges`;
}

export function wrapLogoPrompt(userPrompt: string): string {
  return `${userPrompt}. Professional logo design, clean typography if text included, scalable vector-style, memorable and distinctive, balanced composition`;
}

export function wrapUIPrompt(userPrompt: string): string {
  return `${userPrompt}. UI/UX concept design, clean interface mockup, modern design system aesthetics, proper spacing and alignment`;
}

export function appendWhiteBackground(prompt: string): string {
  return `${prompt}, on a pure solid white #FFFFFF background`;
}

export const EDIT_TO_BLACK_PROMPT = 'Change the white background to a solid pure black #000000. Keep everything else exactly unchanged';

export const REMOVE_BG_TO_WHITE_PROMPT = 'Change the background to pure solid white #FFFFFF. Keep the subject exactly unchanged';

export const REMOVE_BG_TO_BLACK_PROMPT = 'Change the background to pure solid black #000000. Keep the subject exactly unchanged';
