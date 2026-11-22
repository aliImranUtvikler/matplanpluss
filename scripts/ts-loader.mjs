import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('@/')) {
    const targetBase = path.join(rootDir, 'src', specifier.slice(2));
    if (fs.existsSync(targetBase + '.ts')) {
      return { url: pathToFileURL(targetBase + '.ts').href, shortCircuit: true };
    }
    if (fs.existsSync(targetBase + '.tsx')) {
      return { url: pathToFileURL(targetBase + '.tsx').href, shortCircuit: true };
    }
    if (fs.existsSync(path.join(targetBase, 'index.ts'))) {
      return { url: pathToFileURL(path.join(targetBase, 'index.ts')).href, shortCircuit: true };
    }
  }

  if (specifier.startsWith('./') || specifier.startsWith('../')) {
    const parentDir = path.dirname(fileURLToPath(context.parentURL));
    const resolvedPath = path.resolve(parentDir, specifier);

    if (fs.existsSync(resolvedPath + '.ts')) {
      return { url: pathToFileURL(resolvedPath + '.ts').href, shortCircuit: true };
    }
    if (fs.existsSync(resolvedPath + '.tsx')) {
      return { url: pathToFileURL(resolvedPath + '.tsx').href, shortCircuit: true };
    }
    if (fs.existsSync(path.join(resolvedPath, 'index.ts'))) {
      return { url: pathToFileURL(path.join(resolvedPath, 'index.ts')).href, shortCircuit: true };
    }
  }

  return nextResolve(specifier, context);
}
