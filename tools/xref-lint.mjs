#!/usr/bin/env node
// Cross-reference linter for penumbra-spec.
// Rule: every `backticked term` used in spec/*.md must be defined either:
//   (a) as a row in 00-architecture.md's "## Terminology" section, OR
//   (b) as a heading in any spec/*.md (### or higher).
// Exits 1 if any term is undefined.

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const SPEC_DIR = "spec";

if (!existsSync(SPEC_DIR)) {
  console.log(`[xref] OK — spec/ directory does not exist yet (no modules to check).`);
  process.exit(0);
}

const files = readdirSync(SPEC_DIR).filter((f) => f.endsWith(".md")).sort();

const definitions = new Set();

// Pass 1: collect all headings from all spec files.
for (const f of files) {
  const text = readFileSync(join(SPEC_DIR, f), "utf8");
  for (const m of text.matchAll(/^#{2,6}\s+(.+?)\s*$/gm)) {
    definitions.add(m[1].trim().toLowerCase());
  }
}

// Pass 2: collect terminology entries from 00-architecture.md.
// Format: a "## Terminology" section followed by `Term` definitions like **`Term`** — definition.
const archPath = join(SPEC_DIR, "00-architecture.md");
if (existsSync(archPath)) {
  const arch = readFileSync(archPath, "utf8");
  const termSection = arch.split(/^##\s+Terminology/m)[1] || "";
  const nextSection = termSection.split(/^##\s+/m)[0];
  for (const m of nextSection.matchAll(/^\*\*`([^`]+)`\*\*/gm)) {
    definitions.add(m[1].trim().toLowerCase());
  }
}

// Pass 3: scan every backticked token in spec/*.md, ignore code blocks.
const allowlist = new Set([
  "MUST", "MAY", "SHOULD", "MUST-NOT", "MUST-NOT-CLAIM",
  "true", "false", "null",
]);

let errors = 0;
for (const f of files) {
  const text = readFileSync(join(SPEC_DIR, f), "utf8");
  // Strip fenced code blocks.
  const stripped = text.replace(/```[\s\S]*?```/g, "");
  const seen = new Set();
  for (const m of stripped.matchAll(/`([A-Z][A-Za-z0-9_-]+|[a-z][A-Za-z0-9_-]+)`/g)) {
    const term = m[1];
    if (allowlist.has(term)) continue;
    if (seen.has(term)) continue;
    seen.add(term);
    if (!definitions.has(term.toLowerCase())) {
      console.error(`[xref] ${f}: undefined term \`${term}\``);
      errors++;
    }
  }
}

if (errors > 0) {
  console.error(`\n[xref] ${errors} undefined term(s). Define in spec/00-architecture.md (## Terminology) or as a heading in another spec module.`);
  process.exit(1);
}
console.log(`[xref] OK — ${definitions.size} definitions found across ${files.length} module(s).`);
