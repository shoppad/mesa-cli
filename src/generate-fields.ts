#!/usr/bin/env node

/**
 * MESA Field Generator
 *
 * Generates MESA field definitions from JSON sample data.
 * Useful for creating input/output field schemas for automations.
 *
 * Usage:
 *   mesa-fields sample.json
 *   mesa-fields sample.json --output ./fields/ --required true
 */

import { Command } from 'commander';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, parse as parsePath, extname } from 'node:path';
import type { Field, FieldType, DataType, GenerateFieldsOptions, ProvidesMapping } from './types/index.js';
import { isObject, isArray } from './types/index.js';

// =============================================================================
// Configuration
// =============================================================================

/**
 * Mapping of key patterns to "provides" values for semantic field detection
 * Keys are regex patterns (case-insensitive), values are the provides string
 */
const PROVIDES_MAPPING: ProvidesMapping = {
  barcode: 'product_barcode',
  sku: 'product_sku',
  product_type: 'product_type',
  vendor: 'product_vendor',
  tags: 'tags',
  email: 'email',
  'first_name|fname|firstname': 'first_name',
  'last_name|lname|lastname': 'last_name',
  'full_name|name': 'full_name',
  phone: 'phone',
  fax: 'fax',
  company: 'company',
  'street2|address2': 'address_street2',
  'street1|address1|street': 'address_street1',
  city: 'address_city',
  'zip|postal': 'address_zip',
  'state|province': 'address_province',
  country: 'address_country',
  country_code: 'address_country_code',
  'latitude|lat': 'address_latitude',
  'longitude|lng|long': 'address_longitude',
};

// =============================================================================
// CLI Setup
// =============================================================================

const program = new Command();

program
  .name('mesa-fields')
  .description('Generate MESA field definitions from JSON sample data')
  .argument('<files...>', 'JSON files to process')
  .option('--output <folder>', 'Output folder (default: ../fields/)')
  .option('--print', 'Print to console instead of saving to file')
  .option('--importance <value>', 'Set importance on all fields')
  .option('--required <value>', 'Set required on all fields (true/false)')
  .option('--allowcustom <value>', 'Set allow_custom_fields on objects/arrays (true/false)')
  .action(main);

// =============================================================================
// Field Generation Logic
// =============================================================================

/**
 * Detect the "provides" value based on the field key
 * Returns empty string if no match found
 */
function detectProvides(key: string): string {
  for (const [pattern, value] of Object.entries(PROVIDES_MAPPING)) {
    const regex = new RegExp(pattern, 'i');
    if (regex.test(key)) {
      return value;
    }
  }
  return '';
}

/**
 * Convert a key to a human-readable label
 *
 * Examples:
 * - "firstName" -> "First Name"
 * - "customer_email" -> "Customer Email"
 * - "productId" -> "Product ID"
 */
function keyToLabel(key: string): string {
  return key
    // Split CamelCase into words (insert space before uppercase letters)
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    // Replace underscores and hyphens with spaces
    .replace(/[_-]/g, ' ')
    // Proper case each word
    .toLowerCase()
    .split(' ')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
    // Fix common abbreviations
    .replace(/\bId\b/g, 'ID')
    .replace(/\bUrl\b/g, 'URL')
    .replace(/\bApi\b/g, 'API');
}

/**
 * Determine the field type based on the JavaScript value type
 */
function getFieldType(value: unknown): { type: FieldType; dataType: DataType } {
  if (isArray(value)) {
    return { type: 'array', dataType: 'array' };
  }

  if (isObject(value)) {
    return { type: 'object', dataType: 'object' };
  }

  switch (typeof value) {
    case 'number':
      return { type: 'text', dataType: 'number' };
    case 'boolean':
      return { type: 'checkbox', dataType: 'boolean' };
    default:
      return { type: 'text', dataType: 'string' };
  }
}

/**
 * Generate field definitions from a JSON object
 *
 * @param json - The JSON data to analyze
 * @param options - Generation options
 * @returns Array of field definitions
 */
function generateFields(
  json: unknown,
  options: {
    required: boolean;
    importance: number | undefined;
    allowCustom: boolean;
  }
): Field[] {
  // Can only generate fields from objects or arrays
  if (!isObject(json) && !isArray(json)) {
    return [];
  }

  // If array, use the first element as the template
  const sourceObject = isArray(json) ? (json[0] as unknown) : json;

  if (!isObject(sourceObject)) {
    return [];
  }

  const fields: Field[] = [];

  for (const [key, value] of Object.entries(sourceObject)) {
    const { type, dataType } = getFieldType(value);

    const field: Field = {
      key,
      label: keyToLabel(key),
      type,
      data_type: dataType,
      description: '',
      required: options.required,
    };

    // Add importance if specified
    if (options.importance !== undefined) {
      field.importance = options.importance;
    }

    // Handle nested objects and arrays
    if (type === 'object' || type === 'array') {
      field.fields = generateFields(value, options);
      field.allow_custom_fields = options.allowCustom;
    } else {
      // Add provides for scalar fields
      const provides = detectProvides(key);
      if (provides) {
        field.provides = provides;
      }
    }

    fields.push(field);
  }

  return fields;
}

// =============================================================================
// Main Function
// =============================================================================

function main(files: string[], opts: GenerateFieldsOptions): void {
  const cwd = process.cwd();

  // Parse options
  const output = opts.output ?? '../fields/';
  const print = Boolean(opts.print);
  const required = opts.required === 'true';
  const importance = opts.importance !== undefined ? parseInt(opts.importance, 10) : undefined;
  const allowCustom = opts.allowcustom !== 'false'; // Default true

  if (files.length === 0) {
    console.log('No files specified. Usage: mesa-fields <file.json> [options]');
    process.exit(1);
  }

  for (const file of files) {
    const filepath = resolve(cwd, file);
    const { base: filename, name } = parsePath(filepath);
    const ext = extname(filename).toLowerCase();

    if (ext !== '.json') {
      console.log(`Skipping ${filename} (not a .json file)`);
      continue;
    }

    if (!existsSync(filepath)) {
      console.log(`Error: File not found: ${filepath}`);
      continue;
    }

    try {
      const content = readFileSync(filepath, 'utf-8');
      const json: unknown = JSON.parse(content);

      const fields = generateFields(json, {
        required,
        importance,
        allowCustom,
      });

      const outputJson = JSON.stringify(fields, null, 2);

      if (print) {
        console.log(`\n=== ${filename} ===`);
        console.log(outputJson);
      } else {
        const outputPath = resolve(cwd, output, `${name}.json`);
        console.log(`Saving ${outputPath}`);
        writeFileSync(outputPath, outputJson);
      }
    } catch (error) {
      if (error instanceof SyntaxError) {
        console.log(`Error: Invalid JSON in ${filename}`);
      } else if (error instanceof Error) {
        console.log(`Error processing ${filename}: ${error.message}`);
      }
    }
  }

  console.log('Done.');
}

// =============================================================================
// Run
// =============================================================================

program.parse();
