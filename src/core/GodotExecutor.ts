/**
 * Godot executor utilities
 * Handles execution of Godot operations and commands
 */

import { spawn } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

import { convertCamelToSnakeCase, OperationParams } from './ParameterNormalizer';
import { normalizePath } from './PathManager';
import { logDebug } from '../utils/Logger';
import { GODOT_DEBUG_MODE } from '../config/config';

// Whitelist of allowed operations to prevent injection
const ALLOWED_OPERATIONS = new Set([
  'create_scene',
  'add_node',
  'edit_node',
  'remove_node',
  'load_sprite',
  'export_mesh_library',
  'save_scene',
  'get_uid',
  'resave_resources',
]);

/**
 * Validate operation name against whitelist
 */
const isValidOperation = (operation: string): boolean => {
  return ALLOWED_OPERATIONS.has(operation);
};

/**
 * Execute a command using spawn and return stdout/stderr as a promise
 */
const spawnAsync = (
  command: string,
  args: string[],
): Promise<{ stdout: string; stderr: string }> => {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, { stdio: 'pipe' });

    let stdout = '';
    let stderr = '';

    proc.stdout?.on('data', (data: Buffer) => {
      stdout += data.toString();
    });

    proc.stderr?.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    proc.on('error', (err) => {
      reject(err);
    });

    proc.on('close', (code) => {
      if (code !== 0 && code !== null) {
        // Return stdout/stderr even on non-zero exit (Godot may exit with errors)
        resolve({ stdout, stderr });
      } else {
        resolve({ stdout, stderr });
      }
    });
  });
};

const getOperationsScriptPath = (): string => {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  return join(__dirname, '..', 'scripts', 'godot_operations.gd');
};

/**
 * Check if the Godot version is 4.4 or later
 */
export const isGodot44OrLater = (version: string): boolean => {
  const match = version.match(/^(\d+)\.(\d+)/);
  if (match) {
    const major = parseInt(match[1], 10);
    const minor = parseInt(match[2], 10);
    return major > 4 || (major === 4 && minor >= 4);
  }
  return false;
};

/**
 * Get Godot version
 */
export const getGodotVersion = async (godotPath: string): Promise<string> => {
  const { stdout } = await spawnAsync(godotPath, ['--version']);
  return stdout.trim();
};

/**
 * Execute a Godot operation using the operations script
 */
export const executeOperation = async (
  operation: string,
  params: OperationParams,
  projectPath: string,
  godotPath: string,
): Promise<{ stdout: string; stderr: string }> => {
  logDebug(`Executing operation: ${operation} in project: ${projectPath}`);
  logDebug(`Original operation params: ${JSON.stringify(params)}`);

  // Validate operation against whitelist to prevent injection
  if (!isValidOperation(operation)) {
    throw new Error(`Invalid operation: ${operation}. Operation not in whitelist.`);
  }

  // Normalize the project path to handle Windows path issues
  const normalizedProjectPath = normalizePath(projectPath);

  // Convert camelCase parameters to snake_case for Godot script
  const snakeCaseParams = convertCamelToSnakeCase(params);
  logDebug(`Converted snake_case params: ${JSON.stringify(snakeCaseParams)}`);

  // Serialize the snake_case parameters to a valid JSON string
  // No shell escaping needed - spawn passes arguments directly
  const paramsJson = JSON.stringify(snakeCaseParams);

  // Get the operations script path
  const operationsScriptPath = getOperationsScriptPath();

  // Build argument array - spawn handles escaping automatically
  const args = [
    '--headless',
    '--path',
    normalizedProjectPath,
    '--script',
    operationsScriptPath,
    operation,
    paramsJson,
  ];

  // Add debug arguments if debug mode is enabled
  if (GODOT_DEBUG_MODE) {
    args.push('--debug-godot');
  }

  logDebug(`Executing: ${godotPath} ${args.join(' ')}`);

  const { stdout, stderr } = await spawnAsync(godotPath, args);

  return { stdout, stderr };
};
