import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import type {
  CollectFilesOptions,
  CollectedFile,
  ExtractResult,
  GenerateOptions,
} from "./types.js";
import { getClient } from "./client.js";
import { GENERATE_SYSTEM_PROMPT } from "./prompts/generate-system.js";

// Files/dirs always excluded
const ALWAYS_SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  ".hg",
  ".svn",
  "dist",
  "build",
  "out",
  ".next",
  ".nuxt",
  "__pycache__",
  ".pytest_cache",
  "coverage",
  ".nyc_output",
  ".heimdall",
]);

const LOCKFILES = new Set([
  "package-lock.json",
  "yarn.lock",
  "bun.lockb",
  "pnpm-lock.yaml",
  "Gemfile.lock",
  "poetry.lock",
  "Cargo.lock",
  "composer.lock",
]);

const BINARY_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".bmp", ".ico", ".svg",
  ".woff", ".woff2", ".ttf", ".eot", ".otf",
  ".zip", ".tar", ".gz", ".bz2", ".rar", ".7z",
  ".exe", ".dll", ".so", ".dylib", ".o", ".a",
  ".pdf", ".doc", ".docx", ".xls", ".xlsx",
  ".mp3", ".mp4", ".wav", ".avi", ".mov",
  ".sqlite", ".db", ".wasm",
]);

/**
 * Simple glob matcher supporting * and ** patterns.
 */
function matchGlob(pattern: string, path: string): boolean {
  // Normalize
  pattern = pattern.replace(/\\/g, "/");
  path = path.replace(/\\/g, "/");

  // Convert glob to regex
  let regex = "^";
  let i = 0;
  while (i < pattern.length) {
    if (pattern[i] === "*" && pattern[i + 1] === "*") {
      if (pattern[i + 2] === "/") {
        regex += "(?:.*/)?";
        i += 3;
      } else {
        regex += ".*";
        i += 2;
      }
    } else if (pattern[i] === "*") {
      regex += "[^/]*";
      i++;
    } else if (pattern[i] === "?") {
      regex += "[^/]";
      i++;
    } else if (".+^${}()|[]\\".includes(pattern[i])) {
      regex += "\\" + pattern[i];
      i++;
    } else {
      regex += pattern[i];
      i++;
    }
  }
  regex += "$";

  return new RegExp(regex).test(path);
}

/**
 * Parse a .gitignore file into patterns.
 */
function parseGitignore(content: string): string[] {
  return content
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));
}

function isIgnoredByGitignore(relativePath: string, patterns: string[]): boolean {
  for (const pattern of patterns) {
    // Directory patterns (ending with /)
    const cleanPattern = pattern.endsWith("/") ? pattern.slice(0, -1) : pattern;

    if (matchGlob(cleanPattern, relativePath)) return true;
    if (matchGlob(cleanPattern, relativePath.split("/")[0])) return true;
    // Also match if any path segment matches
    if (!cleanPattern.includes("/")) {
      const segments = relativePath.split("/");
      if (segments.some((s) => matchGlob(cleanPattern, s))) return true;
    }
  }
  return false;
}

/**
 * Recursively walk a directory.
 */
function walkDir(dir: string, basePath: string): string[] {
  const results: string[] = [];

  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return results;
  }

  for (const entry of entries) {
    const fullPath = join(dir, entry);
    let stat;
    try {
      stat = statSync(fullPath);
    } catch {
      continue; // Skip broken symlinks, etc.
    }

    if (stat.isSymbolicLink?.()) continue;

    if (stat.isDirectory()) {
      if (ALWAYS_SKIP_DIRS.has(entry)) continue;
      results.push(...walkDir(fullPath, basePath));
    } else if (stat.isFile()) {
      results.push(fullPath);
    }
  }

  return results;
}

/**
 * Collect source files from a directory for context assembly.
 */
export async function collectFiles(
  options: CollectFilesOptions
): Promise<CollectedFile[]> {
  const basePath = resolve(options.path);

  // Load .gitignore if present
  const gitignorePath = join(basePath, ".gitignore");
  const gitignorePatterns = existsSync(gitignorePath)
    ? parseGitignore(readFileSync(gitignorePath, "utf-8"))
    : [];

  const allPaths = walkDir(basePath, basePath);
  const files: CollectedFile[] = [];

  for (const fullPath of allPaths) {
    const relativePath = relative(basePath, fullPath).replace(/\\/g, "/");
    const filename = relativePath.split("/").pop() ?? "";
    const ext = "." + filename.split(".").pop();

    // Skip lockfiles
    if (LOCKFILES.has(filename)) continue;

    // Skip binary extensions
    if (BINARY_EXTENSIONS.has(ext.toLowerCase())) continue;

    // Skip .gitignore patterns
    if (isIgnoredByGitignore(relativePath, gitignorePatterns)) continue;

    // Apply --include filter
    if (options.include && options.include.length > 0) {
      const matches = options.include.some((pattern) =>
        matchGlob(pattern, relativePath)
      );
      if (!matches) continue;
    }

    // Apply --exclude filter
    if (options.exclude && options.exclude.length > 0) {
      const excluded = options.exclude.some((pattern) =>
        matchGlob(pattern, relativePath)
      );
      if (excluded) continue;
    }

    // Read file content — skip if binary
    let content: string;
    try {
      content = readFileSync(fullPath, "utf-8");
      // Check for null bytes (binary indicator)
      if (content.includes("\0")) continue;
    } catch {
      continue;
    }

    files.push({
      relativePath,
      content,
      sizeBytes: Buffer.byteLength(content, "utf-8"),
    });
  }

  // Sort by path for deterministic ordering
  files.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  return files;
}

/**
 * Assemble collected files into a single context string with headers.
 */
export function assembleContext(files: CollectedFile[]): string {
  if (files.length === 0) return "";

  return files
    .map((f) => `--- FILE: ${f.relativePath} ---\n${f.content}`)
    .join("\n\n");
}

/**
 * Estimate token count (~chars/4).
 */
export function estimateTokens(files: CollectedFile[]): number {
  const totalChars = files.reduce((sum, f) => sum + f.content.length, 0);
  return Math.round(totalChars / 4);
}

/**
 * Extract YAML from an LLM response, stripping code fences.
 */
export function extractYaml(response: string): ExtractResult {
  // Try to find ```yaml ... ``` or ``` ... ``` blocks
  const fenceRegex = /```(?:ya?ml)?\s*\n([\s\S]*?)```/;
  const match = response.match(fenceRegex);

  if (match) {
    return {
      yaml: match[1].trim(),
      hadFences: true,
    };
  }

  return {
    yaml: response.trim(),
    hadFences: false,
  };
}

const MAX_RETRIES = 3;

/**
 * Generate a bifrost.yaml policy from a codebase using Claude.
 * Uses extended thinking for deep analysis and retries on validation failure.
 */
export async function generatePolicy(
  options: GenerateOptions
): Promise<string> {
  const client = getClient();

  // Collect files
  const files = await collectFiles({
    path: options.path,
    include: options.include,
    exclude: options.exclude,
  });

  if (files.length === 0) {
    throw new Error(
      `No source files found in ${options.path}. ` +
      "Check that the directory contains code and is not excluded by filters."
    );
  }

  const tokenEstimate = estimateTokens(files);
  const context = assembleContext(files);
  const realm = options.realm ?? resolve(options.path).split("/").pop() ?? "my-project";

  console.error(`[heimdall] Collected ${files.length} files (~${tokenEstimate.toLocaleString()} tokens)`);
  console.error(`[heimdall] Generating policy for realm "${realm}" with extended thinking...`);

  const { loadBifrostConfig } = await import("@heimdall/core");
  const model = options.model ?? "claude-opus-4-6-20250219";

  let lastYaml = "";
  let lastError = "";

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const isRetry = attempt > 1;
    const userContent = isRetry
      ? `The previously generated YAML had a validation error:\n\n${lastError}\n\nHere was the invalid YAML:\n\`\`\`yaml\n${lastYaml}\n\`\`\`\n\nFix the error and regenerate a valid bifrost.yaml. Output ONLY the corrected YAML in \`\`\`yaml fences.`
      : `Generate a Heimdall bifrost.yaml security policy for this codebase.\n\nRealm: ${realm}\n\nCodebase:\n\n${context}`;

    if (isRetry) {
      console.error(`[heimdall] Retry ${attempt}/${MAX_RETRIES} — fixing validation error...`);
    }

    const response = await client.messages.create({
      model,
      max_tokens: 16000,
      thinking: {
        type: "enabled",
        budget_tokens: 10000,
      },
      system: GENERATE_SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: userContent }],
        },
      ],
    });

    // Log thinking tokens used
    const thinkingBlock = response.content.find((b) => b.type === "thinking");
    if (thinkingBlock && thinkingBlock.type === "thinking") {
      const thinkingTokens = Math.round(thinkingBlock.thinking.length / 4);
      console.error(`[heimdall] Extended thinking: ~${thinkingTokens.toLocaleString()} tokens used`);
    }

    // Extract text content
    const textBlock = response.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      throw new Error("No text response from model");
    }

    const { yaml } = extractYaml(textBlock.text);
    lastYaml = yaml;

    // Validate through loadBifrostConfig
    try {
      loadBifrostConfig(yaml);
      console.error(`[heimdall] Policy validated successfully`);
      return yaml;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      console.error(`[heimdall] Validation failed (attempt ${attempt}/${MAX_RETRIES}): ${lastError}`);

      if (attempt === MAX_RETRIES) {
        console.error(`[heimdall] Warning: returning policy with validation issues after ${MAX_RETRIES} attempts`);
        return yaml;
      }
    }
  }

  return lastYaml;
}
