#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));

// Keep this explicit: missing public contracts or entry points must fail CI.
export const requiredArtifacts = [
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

export function findMissingLocalLinks(markdownPath) {
  const markdown = readFileSync(markdownPath, "utf8");
  const targets = [
    ...markdown.matchAll(/!?\[[^\]\n]*\]\(\s*(<[^>]+>|[^\s)]+)(?:\s+[^)]*)?\)/g),
    ...markdown.matchAll(/^\s*\[[^\]\n]+\]:\s*(<[^>]+>|\S+)/gm),
  ].map((match) => match[1].replace(/^<|>$/g, ""));
  return targets.filter((target) => {
    if (/^(?:https?:|mailto:|#|\/)/i.test(target)) return false;
    const path = decodeURIComponent(target.split(/[?#]/, 1)[0]);
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
    for (const target of findMissingLocalLinks(path)) missing.push(`${file}: missing link target ${target}`);
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
