#!/usr/bin/env node
import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "@shaderfrog/glsl-parser";

const rootPath = fileURLToPath(new URL("..", import.meta.url));

async function collectShaderFiles(dirPath, files = []) {
  const entries = await readdir(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isSymbolicLink && entry.isSymbolicLink()) {
      continue;
    }

    const entryPath = join(dirPath, entry.name);
    if (entry.isDirectory()) {
      try {
        await collectShaderFiles(entryPath, files);
      } catch (error) {
        if (error && error.code === "ENOENT") {
          console.warn(`Skipping missing directory ${entryPath}`);
          continue;
        }
        throw error;
      }
    } else if (/\.(glsl|vert|frag)$/i.test(entry.name)) {
      files.push(entryPath);
    }
  }
  return files;
}

function inferStage(filename) {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".vert") || lower.includes(".vert.")) {
    return "vertex";
  }
  if (lower.endsWith(".frag") || lower.includes(".frag.")) {
    return "fragment";
  }
  throw new Error(`Unable to infer shader stage from filename: ${filename}`);
}

function findDuplicateUniforms(source) {
  const seen = new Set();
  const duplicates = new Set();
  const uniformBlock = /^\s*uniform\s+([^;]+);/gm;
  let match;
  while ((match = uniformBlock.exec(source)) !== null) {
    const declarations = match[1].split(",");
    for (const decl of declarations) {
      const trimmed = decl.trim();
      if (!trimmed) {
        continue;
      }
      const parts = trimmed.split(/\s+/);
      const namePart = parts[parts.length - 1].replace(/\[.*\]$/, "");
      if (!namePart) {
        continue;
      }
      if (seen.has(namePart)) {
        duplicates.add(namePart);
      } else {
        seen.add(namePart);
      }
    }
  }
  return [...duplicates];
}

const shadersDir = fileURLToPath(new URL("../src", import.meta.url));
const shaderFiles = await collectShaderFiles(shadersDir);

console.log(`Found ${shaderFiles.length} shader file(s) under src.`);

if (shaderFiles.length === 0) {
  console.log("No shader files found. Skipping validation.");
  process.exit(0);
}

let hasError = false;

for (const shaderPath of shaderFiles) {
  const filePath = relative(rootPath, shaderPath);
  const stage = inferStage(shaderPath);
  const source = await readFile(shaderPath, "utf8");
  try {
    parse(source, { stage: stage === "vertex" ? "vertex" : "fragment", quiet: true });
    const duplicates = findDuplicateUniforms(source);
    if (duplicates.length > 0) {
      hasError = true;
      console.error(`✗ ${filePath} (${stage})`);
      console.error(`Duplicate uniform declarations found: ${duplicates.join(", ")}`);
    } else {
      console.log(`✓ ${filePath} (${stage})`);
    }
  } catch (error) {
    hasError = true;
    console.error(`✗ ${filePath} (${stage})`);
    console.error((error && error.message) || error);
  }
}

if (hasError) {
  process.exit(1);
}
