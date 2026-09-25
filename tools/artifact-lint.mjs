#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));

// Keep this explicit: missing public contracts or entry points must fail CI.
export const requiredArtifacts = [
  "spec/08-conformance-testing.md",
  "schemas/manifest.schema.json",
  "schemas/decoy-content.schema.json",
  "schemas/scenario.schema.json",
  "examples/manifests/coercion-calculator.json",
  "examples/decoy-content/tourist-info.json",
  "examples/scenarios/coercion-calculator.json",
  "conformance/vectors",
  "lib/contracts.mjs",
  "lib/reference-machine.mjs",
  "lib/scenario.mjs",
  "tools/validate-artifacts.mjs",
  "tools/artifact-lint.mjs",
  "tools/conformance.mjs",
  "tools/simulate.mjs",
  "tools/xref-lint.mjs",
];

export function findMissingRequiredArtifacts(root = repositoryRoot) {
  return requiredArtifacts.filter((path) => !existsSync(join(root, path)));
}

function inlineLinkTargets(markdown) {
  const targets = [];
  for (let i = 0; i < markdown.length; i += 1) {
    if (markdown[i] === "\\") {
      i += 1;
      continue;
    }
    if (markdown[i] !== "[") continue;

    let cursor = i + 1;
    let brackets = 1;
    while (cursor < markdown.length && brackets > 0) {
      const character = markdown[cursor];
      if (character === "\\") {
        cursor += 2;
        continue;
      }
      if (character === "[") brackets += 1;
      if (character === "]") brackets -= 1;
      cursor += 1;
    }
    if (brackets !== 0 || markdown[cursor] !== "(") continue;
    cursor += 1;
    while (markdown[cursor] === " " || markdown[cursor] === "\t") cursor += 1;

    let target = "";
    if (markdown[cursor] === "<") {
      cursor += 1;
      while (cursor < markdown.length && markdown[cursor] !== ">") {
        if (markdown[cursor] === "\\" && cursor + 1 < markdown.length) cursor += 1;
        target += markdown[cursor];
        cursor += 1;
      }
      if (markdown[cursor] !== ">") continue;
      cursor += 1;
    } else {
      let parentheses = 0;
      while (cursor < markdown.length) {
        const character = markdown[cursor];
        if (character === "\\" && cursor + 1 < markdown.length) {
          target += markdown[cursor + 1];
          cursor += 2;
          continue;
        }
        if (character === "(") parentheses += 1;
        if (character === ")") {
          if (parentheses === 0) break;
          parentheses -= 1;
        }
        if (/\s/.test(character) && parentheses === 0) break;
        target += character;
        cursor += 1;
      }
      if (parentheses !== 0) continue;
    }

    while (markdown[cursor] === " " || markdown[cursor] === "\t") cursor += 1;
    if (markdown[cursor] === "\"" || markdown[cursor] === "'") {
      const quote = markdown[cursor];
      cursor += 1;
      while (cursor < markdown.length && markdown[cursor] !== quote) {
        if (markdown[cursor] === "\\") cursor += 1;
        cursor += 1;
      }
      if (markdown[cursor] !== quote) continue;
      cursor += 1;
      while (markdown[cursor] === " " || markdown[cursor] === "\t") cursor += 1;
    }
    if (markdown[cursor] !== ")") continue;
    targets.push(target);
    i = cursor;
  }
  return targets;
}

export function findMissingLocalLinks(markdownPath) {
  const markdown = readFileSync(markdownPath, "utf8");
  const targets = [
    ...inlineLinkTargets(markdown),
    ...[...markdown.matchAll(/^\s*\[[^\]\n]+\]:\s*(<[^>]+>|\S+)/gm)]
      .map((match) => match[1].replace(/^<|>$/g, "")),
  ];
  return targets.filter((target) => {
    if (/^(?:https?:|mailto:|#|\/)/i.test(target)) return false;
    let path;
    try {
      path = decodeURIComponent(target.split(/[?#]/, 1)[0]);
    } catch {
      return true;
    }
    return path.length > 0 && !existsSync(resolve(dirname(markdownPath), path));
  });
}

export function lintArtifacts(root = repositoryRoot) {
  const missing = findMissingRequiredArtifacts(root).map((path) => `missing artifact: ${path}`);
  const specDir = join(root, "spec");
  const markdownFiles = ["README.md", "CHANGELOG.md"];
  if (existsSync(specDir)) {
    markdownFiles.push(...readdirSync(specDir).filter((name) => name.endsWith(".md")).map((name) => join("spec", name)));
  }
  for (const file of markdownFiles) {
    const path = join(root, file);
    if (!existsSync(path)) {
      missing.push(`missing Markdown file: ${file}`);
      continue;
    }
    for (const target of findMissingLocalLinks(path)) missing.push(`${file}: invalid or missing link target ${target}`);
  }
  return missing;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const problems = lintArtifacts();
  if (problems.length > 0) {
    for (const problem of problems) console.error(problem);
    process.exitCode = 1;
  } else {
    console.log("Artifact inventory and relative Markdown links validated.");
  }
}
