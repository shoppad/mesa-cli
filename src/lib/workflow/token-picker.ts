/**
 * Token Picker
 *
 * Handles extraction and selection of token references from previous steps.
 * Tokens use Liquid-style templating: {{step_key.field.path}}
 */

import { search, confirm } from '@inquirer/prompts';
import type { WorkflowStep, TokenPath } from '../../types/index.js';

/**
 * Extract all available tokens from previous workflow steps
 * Parses the response_example from each step to build token paths
 */
export function extractAvailableTokens(steps: WorkflowStep[]): TokenPath[] {
  const tokens: TokenPath[] = [];

  for (const step of steps) {
    if (step.response_example) {
      const stepTokens = extractTokensFromObject(
        step.key,
        step.name,
        step.response_example,
        ''
      );
      tokens.push(...stepTokens);
    }
  }

  return tokens;
}

/**
 * Recursively extract token paths from an object
 */
function extractTokensFromObject(
  stepKey: string,
  stepName: string,
  obj: Record<string, unknown>,
  prefix: string
): TokenPath[] {
  const tokens: TokenPath[] = [];

  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    const label = formatLabel(key);
    // Build description from the path hierarchy
    const pathParts = path.split('.');
    const description = pathParts.length > 1
      ? `Path: ${pathParts.map(p => formatLabel(p)).join(' > ')}`
      : undefined;

    if (value === null || value === undefined) {
      // Add token for null/undefined values
      tokens.push({
        step_key: stepKey,
        step_name: stepName,
        path,
        label,
        description,
        full_token: `{{${stepKey}.${path}}}`,
      });
    } else if (Array.isArray(value)) {
      // For arrays, add a token for the first element path pattern
      if (value.length > 0 && typeof value[0] === 'object' && value[0] !== null) {
        // Add tokens for first array element's properties
        const arrayItemTokens = extractTokensFromObject(
          stepKey,
          stepName,
          value[0] as Record<string, unknown>,
          `${path}.0`
        );
        tokens.push(...arrayItemTokens);
      }
      // Also add a token for the array itself
      tokens.push({
        step_key: stepKey,
        step_name: stepName,
        path,
        label: `${label} (array)`,
        description: `Array of ${formatLabel(key)} items`,
        full_token: `{{${stepKey}.${path}}}`,
      });
    } else if (typeof value === 'object') {
      // Recurse into nested objects
      const nestedTokens = extractTokensFromObject(
        stepKey,
        stepName,
        value as Record<string, unknown>,
        path
      );
      tokens.push(...nestedTokens);
    } else {
      // Primitive value - add as token with example value
      const exampleValue = typeof value === 'string' && value.length > 50
        ? value.substring(0, 47) + '...'
        : String(value);
      tokens.push({
        step_key: stepKey,
        step_name: stepName,
        path,
        label,
        description: description ?? `Example: ${exampleValue}`,
        full_token: `{{${stepKey}.${path}}}`,
      });
    }
  }

  return tokens;
}

/**
 * Format a key into a human-readable label
 */
function formatLabel(key: string): string {
  return key
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Interactive token selection from previous steps
 * @param previousSteps - Steps to extract tokens from
 * @returns Selected token string or null if cancelled
 */
export async function selectToken(previousSteps: WorkflowStep[]): Promise<string | null> {
  const tokens = extractAvailableTokens(previousSteps);

  if (tokens.length === 0) {
    console.log('No tokens available from previous steps.');
    return null;
  }

  const selected = await search<string>({
    message: 'Select token to insert:',
    source: async (input) => {
      const term = (input ?? '').toLowerCase();

      // Filter tokens by search term
      const filtered = tokens.filter(
        (t) =>
          t.path.toLowerCase().includes(term) ||
          t.label.toLowerCase().includes(term) ||
          t.step_key.toLowerCase().includes(term) ||
          t.step_name.toLowerCase().includes(term) ||
          (t.description?.toLowerCase().includes(term) ?? false)
      );

      // Group by step for better organization
      const grouped = new Map<string, TokenPath[]>();
      for (const token of filtered) {
        const group = grouped.get(token.step_key) || [];
        group.push(token);
        grouped.set(token.step_key, group);
      }

      // Flatten back to array with user-friendly display
      // Format: "Step Name > Field Label" with description
      const choices: { name: string; value: string; description?: string }[] = [];
      for (const [_stepKey, stepTokens] of grouped) {
        for (const token of stepTokens) {
          // Build display name: "Shopify - Order Created > Customer > Email"
          const pathLabels = token.path.split('.').map(p => formatLabel(p));
          const displayName = `${token.step_name} > ${pathLabels.join(' > ')}`;

          choices.push({
            name: displayName,
            value: token.full_token,
            description: token.description,
          });
        }
      }

      // Return all choices - the search component handles scrolling
      return choices;
    },
  });

  return selected;
}

/**
 * Prompt user to insert a token or enter a literal value
 * @param fieldLabel - Label of the field being configured
 * @param previousSteps - Steps to extract tokens from
 * @returns Object with the value and whether it contains tokens
 */
export async function promptWithTokenOption(
  fieldLabel: string,
  previousSteps: WorkflowStep[]
): Promise<{ value: string; hasTokens: boolean }> {
  if (previousSteps.length === 0) {
    return { value: '', hasTokens: false };
  }

  const tokens = extractAvailableTokens(previousSteps);
  if (tokens.length === 0) {
    return { value: '', hasTokens: false };
  }

  const useToken = await confirm({
    message: `Insert token from previous step for "${fieldLabel}"?`,
    default: false,
  });

  if (useToken) {
    const token = await selectToken(previousSteps);
    if (token) {
      return { value: token, hasTokens: true };
    }
  }

  return { value: '', hasTokens: false };
}

/**
 * Check if a string contains token references
 */
export function hasTokenReferences(value: string): boolean {
  return /\{\{[^}]+\}\}/.test(value);
}

/**
 * Extract all token references from a string
 */
export function extractTokenReferences(value: string): string[] {
  const matches = value.match(/\{\{([^}]+)\}\}/g);
  return matches || [];
}

/**
 * Validate that all token references in a string refer to valid step outputs
 */
export function validateTokenReferences(
  value: string,
  availableStepKeys: string[]
): { valid: boolean; invalidTokens: string[] } {
  const tokens = extractTokenReferences(value);
  const invalidTokens: string[] = [];

  for (const token of tokens) {
    // Extract step key from token (e.g., {{step_key.path}} -> step_key)
    const match = token.match(/\{\{([^.}]+)/);
    if (match) {
      const stepKey = match[1];
      if (!availableStepKeys.includes(stepKey)) {
        invalidTokens.push(token);
      }
    }
  }

  return {
    valid: invalidTokens.length === 0,
    invalidTokens,
  };
}
