import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FACTS, FINDINGS, SOURCES } from '../src/index.js';

const root = resolve(fileURLToPath(import.meta.url), '..', '..');
const read = (rel) => readFile(resolve(root, rel), 'utf8');
const HOMEPAGE = 'https://innerluxes.dev/software-development/databases';

async function markdownFiles() {
  const docs = (await readdir(resolve(root, 'docs'), { recursive: true })).filter((f) => f.endsWith('.md')).map((f) => `docs/${f.split('\\').join('/')}`);
  return ['README.md', 'LICENSE', 'CHANGELOG.md', 'CONTRIBUTING.md', 'SECURITY.md', ...docs];
}

test('package.json: a zero-dependency Node 22 ES module with the bin, the scripts and the homepage', async () => {
  const pkg = JSON.parse(await read('package.json'));
  assert.equal(pkg.name, 'sql-migration-check');
  assert.equal(pkg.type, 'module');
  assert.equal(pkg.engines.node, '>=22');
  assert.equal(pkg.homepage, HOMEPAGE);
  assert.equal(pkg.license, 'MIT');
  assert.equal(pkg.dependencies, undefined);
  assert.equal(pkg.devDependencies, undefined);
  assert.equal(pkg.bin['sql-migration-check'], 'bin/sql-migration-check.js');
  for (const script of ['test', 'check', 'example', 'test:coverage']) assert.ok(pkg.scripts[script], script);
  assert.deepEqual(Object.keys(JSON.parse(await read('package-lock.json')).packages), ['']);
});

test('README: the closing Background section links to the databases page with the agreed anchor text', async () => {
  const readme = await read('README.md');
  const parts = readme.split(/^## /m);
  const background = parts.find((p) => p.startsWith('Background'));
  assert.ok(background, 'a Background section');
  assert.ok(background.includes(`[database development services](${HOMEPAGE})`));
  assert.equal(parts.at(-1).split('\n')[0], 'License');
  assert.equal(parts.at(-2).split('\n')[0], 'Background');
});

test('README and documents: no date and no year anywhere', async () => {
  for (const file of await markdownFiles()) {
    const text = await read(file);
    assert.doesNotMatch(text, /\b(?:19|20)\d{2}\b/, file);
    assert.doesNotMatch(text, /\b(?:January|February|March|April|June|July|August|September|October|November|December)\s+\d/, file);
  }
});

test('LICENSE: MIT with the copyright line of INNERLUXES and no year', async () => {
  const license = await read('LICENSE');
  assert.ok(license.startsWith('MIT License\n\nCopyright (c) INNERLUXES\n'));
});

test('SECURITY.md: how to report, and no promise about reply times', async () => {
  const text = await read('SECURITY.md');
  assert.match(text, /info@innerluxes\.dev/);
  assert.doesNotMatch(text, /within\s+\d|\bSLA\b|business days|hours|within a (?:day|week)|\bdays\b/i);
});

test('workflows: every action is pinned to a commit, the CI runs three systems and two Node versions, and the SSDF gate is there', async () => {
  for (const name of ['ci.yml', 'codeql.yml', 'release.yml']) {
    const text = await read(`.github/workflows/${name}`);
    const uses = [...text.matchAll(/^\s*- uses: (\S+)/gm)].map((m) => m[1]);
    assert.ok(uses.length > 0, name);
    for (const u of uses) assert.match(u, /@[0-9a-f]{40}$/, `${name}: ${u}`);
  }
  const ci = await read('.github/workflows/ci.yml');
  assert.match(ci, /os: \[ubuntu-latest, windows-latest, macos-latest\]/);
  assert.match(ci, /node: \[22, 24\]/);
  assert.match(ci, /node \.ssdf\/bin\/ssdf-repo-check\.js repo --format markdown >> "\$GITHUB_STEP_SUMMARY"/);
  assert.match(ci, /node \.ssdf\/bin\/ssdf-repo-check\.js repo --require-all --fail-on-problem/);
  assert.match(ci, /repository: INNERLUXES\/ssdf-repo-check/);
  assert.match(ci, /npm run check/);
  assert.match(ci, /npm run example/);
});

test('workflows: the pinned commits are the ones that the sibling repository uses', async () => {
  const known = new Set([
    'actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1',
    'actions/setup-node@820762786026740c76f36085b0efc47a31fe5020',
    'github/codeql-action/init@2892aa5e19bbd11bc0cff5427e3b750a04d9e3c2',
    'github/codeql-action/analyze@2892aa5e19bbd11bc0cff5427e3b750a04d9e3c2',
    'actions/attest-build-provenance@4d101475d8b20a2381f78447822ac1eab6504dd8'
  ]);
  for (const name of ['ci.yml', 'codeql.yml', 'release.yml']) {
    const text = await read(`.github/workflows/${name}`);
    for (const m of text.matchAll(/^\s*- uses: (\S+)/gm)) assert.ok(known.has(m[1]), `${name}: ${m[1]}`);
  }
  assert.match(await read('.github/workflows/ci.yml'), /ref: dfda194a3ed35623b8b420df05e110b66d984586 # v1\.0\.0/);
});

test('release workflow: a tgz, a CycloneDX SBOM and SHA256SUMS named for this package', async () => {
  const release = await read('.github/workflows/release.yml');
  assert.match(release, /npm pack --pack-destination dist/);
  assert.match(release, /npm sbom --sbom-format cyclonedx > dist\/sql-migration-check\.cdx\.json/);
  assert.match(release, /sha256sum \* > SHA256SUMS/);
  assert.doesNotMatch(release, /openapi-security-check/);
});

test('repository files: Dependabot for actions and npm, CodeQL, CODEOWNERS, a pull request template and the line-end rules', async () => {
  const dependabot = await read('.github/dependabot.yml');
  assert.match(dependabot, /package-ecosystem: github-actions/);
  assert.match(dependabot, /package-ecosystem: npm/);
  assert.match(await read('.github/workflows/codeql.yml'), /security-extended/);
  assert.match(await read('.github/CODEOWNERS'), /^\* @innerluxesdev$/m);
  assert.match(await read('.github/pull_request_template.md'), /npm run example/);
  const attributes = await read('.gitattributes');
  assert.match(attributes, /^\* text=auto eol=lf$/m);
  assert.match(attributes, /^examples\/output\/\*\.csv -text$/m);
});

test('the repository names no other project and no tool or conversation that wrote it', async () => {
  for (const file of ['README.md', 'CHANGELOG.md', 'CONTRIBUTING.md', 'SECURITY.md', '.github/workflows/ci.yml', '.github/workflows/release.yml', '.github/CODEOWNERS', '.github/pull_request_template.md']) {
    const text = await read(file);
    assert.doesNotMatch(text, /openapi-security-check|desktop-release-check|electron/i, file);
  }
});

test('docs: every finding id of the tool is described in docs/method.md and in the README table', async () => {
  const method = await read('docs/method.md');
  const readme = await read('README.md');
  const sources = await read('docs/rules-and-sources.md');
  for (const f of FINDINGS) {
    assert.ok(method.includes(`\`${f.id}\``), `docs/method.md: ${f.id}`);
    assert.ok(readme.includes(`| \`${f.id}\` |`), `README: ${f.id}`);
    assert.ok(sources.includes(`\`${f.id}\``), `docs/rules-and-sources.md: ${f.id}`);
  }
});

test('docs: docs/rules-and-sources.md quotes every sentence of src/data.js and lists every saved page', async () => {
  const sources = await read('docs/rules-and-sources.md');
  for (const [key, fact] of Object.entries(FACTS)) assert.ok(sources.includes(fact.text.replace(/\|/g, '\\|')), key);
  for (const s of SOURCES) {
    assert.ok(sources.includes(s.url), s.url);
    assert.ok(sources.includes(`research/sources/${s.file}`), s.file);
  }
});

test('README: the usage, the options and the exit codes are the ones of the tool', async () => {
  const readme = await read('README.md');
  for (const text of ['--format <name>', '--fail-on <level>', '--since <file>', 'info never fails the run']) assert.ok(readme.includes(text), text);
  assert.match(readme, /`0` no finding at the `--fail-on` level, `1` at least one such finding/);
  assert.match(readme, /`2` a usage or input error/);
});

test('the examples: five migrations that are wrong on purpose and a fixed set, in plain files', async () => {
  const bad = (await readdir(resolve(root, 'examples/clinic-bookings'))).sort();
  assert.deepEqual(bad, ['001_create_tables.sql', '002_speed_up_lookups.sql', '003_patient_details.sql', '004_cleanup.sql', '005_finishing_touches.sql']);
  const fixed = (await readdir(resolve(root, 'examples/clinic-bookings-fixed'))).sort();
  assert.equal(fixed.length, 4);
  assert.deepEqual((await readdir(resolve(root, 'examples/output'))).sort(), ['clinic-bookings.csv', 'clinic-bookings.json', 'clinic-bookings.md', 'clinic-bookings.txt']);
});

test('src imports no network, process or code evaluation module, and calls none of them', async () => {
  const forbidden = /from 'node:(?:net|http|https|http2|dgram|dns|tls|child_process|worker_threads|cluster|vm|inspector)'|\bfetch\(|XMLHttpRequest|WebSocket|\beval\(|new Function\(|\brequire\(|\bimport\(/;
  for (const file of await readdir(resolve(root, 'src'))) assert.doesNotMatch(await read(`src/${file}`), forbidden, file);
});

test('src reads only the files it is given: the only imports of the file system are in src/files.js', async () => {
  for (const file of await readdir(resolve(root, 'src'))) {
    const text = await read(`src/${file}`);
    if (file === 'files.js') assert.match(text, /from 'node:fs\/promises'/);
    else if (file === 'cli.js') assert.match(text, /import \{ readFileSync \} from 'node:fs'/);
    else assert.doesNotMatch(text, /from 'node:fs/, file);
  }
});

test('src does not run a regular expression over the raw text of a file: the tokenizer reads characters', async () => {
  const text = await read('src/tokenizer.js');
  assert.doesNotMatch(text, /\.(?:match|matchAll|replace|replaceAll|test|exec|search|split)\(\s*\//);
  assert.doesNotMatch(text, /new RegExp/);
});
