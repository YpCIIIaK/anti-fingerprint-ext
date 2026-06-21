// Build orchestrator. Vite can only emit a single IIFE per build (Rollup forbids
// multiple inputs with the iife format), so we run one build per content entry.
// Each content script must be a self-contained classic script — bridge/inject run
// in content-script worlds and the SW runs as a classic worker.
import { build } from 'vite';
import { cp, rm, mkdir, readdir, stat, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const watch = process.argv.includes('--watch');
const outDir = path.resolve('dist');

const entries = {
  background: 'src/background/sw.ts',
  bridge: 'src/content/bridge.ts',
  inject: 'src/content/inject.ts',
  popup: 'src/ui/popup/popup.ts',
  options: 'src/ui/options/options.ts',
};

async function buildEntry(name, input) {
  await build({
    configFile: false,
    logLevel: 'warn',
    build: {
      outDir,
      emptyOutDir: false,
      minify: false,
      sourcemap: false,
      watch: watch ? {} : null,
      lib: {
        entry: path.resolve(input),
        formats: ['iife'],
        name: `pg_${name}`,
        fileName: () => `${name}.js`,
      },
      rollupOptions: { output: { entryFileNames: `${name}.js`, extend: true } },
    },
  });
}

async function copyStatic() {
  // copy everything under static/ verbatim into dist/
  const staticDir = path.resolve('static');
  for (const item of await readdir(staticDir)) {
    const src = path.join(staticDir, item);
    const dest = path.join(outDir, item);
    const s = await stat(src);
    if (s.isDirectory()) await cp(src, dest, { recursive: true });
    else await cp(src, dest);
  }
}

// Compile rules/trackers.txt → dist/rules/ruleset.json (declarativeNetRequest).
// Plain domains are bundled into a single block rule (requestDomains also covers
// subdomains); entries carrying a path become individual urlFilter rules.
async function compileRules() {
  const raw = await readFile(path.resolve('rules/trackers.txt'), 'utf8');
  const lines = raw
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));

  const domains = [];
  const pathEntries = [];
  for (const l of lines) (l.includes('/') ? pathEntries : domains).push(l);

  const rules = [];
  if (domains.length) {
    rules.push({
      id: 1,
      priority: 1,
      action: { type: 'block' },
      condition: { requestDomains: domains, domainType: 'thirdParty' },
    });
  }
  let id = 2;
  for (const entry of pathEntries) {
    rules.push({
      id: id++,
      priority: 1,
      action: { type: 'block' },
      condition: { urlFilter: `||${entry}`, domainType: 'thirdParty' },
    });
  }

  await mkdir(path.join(outDir, 'rules'), { recursive: true });
  await writeFile(
    path.join(outDir, 'rules', 'ruleset.json'),
    JSON.stringify(rules)
  );
  console.log(`  rules: ${domains.length} domains + ${pathEntries.length} path rules`);
}

async function main() {
  if (existsSync(outDir)) await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });
  for (const [name, input] of Object.entries(entries)) await buildEntry(name, input);
  await copyStatic();
  await compileRules();
  console.log(`\n✓ Built extension into ${outDir}${watch ? ' (watching)' : ''}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
