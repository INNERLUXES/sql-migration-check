// Runs the README examples, checks that they report what the README shows, and writes the reports of the failing
// example to examples/output. CI runs it and then fails if those files changed, so the example output in the
// repository is always the real output.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { main, LIMITS } from '../src/index.js';

const root = resolve(fileURLToPath(import.meta.url), '..', '..');

// Runs the tool on files of the repository; paths in the report are relative to the repository.
async function run(argv) {
  let out = '';
  const code = await main(argv, { out: (t) => { out += t; }, err: (t) => process.stderr.write(t) }, LIMITS, root);
  return { code, out };
}

const problems = [];
function expect(name, result, code, expected, unwanted) {
  const missing = expected.filter((e) => !result.out.includes(e));
  const wrong = unwanted.filter((e) => result.out.includes(e));
  if (result.code !== code || missing.length || wrong.length) {
    problems.push(`${name}: unexpected report (exit code ${result.code}, expected ${code}; missing: ${missing.join(' / ') || 'none'}; should not appear: ${wrong.join(' / ') || 'none'})`);
  }
}

const failingArgs = ['examples/clinic-bookings', '--since', '002_speed_up_lookups.sql'];
const failing = await run(failingArgs);
process.stdout.write(failing.out);
expect('failing migrations', failing, 1, [
  'findings: 7 error, 11 warning, 2 info',
  'WARNING  index-not-concurrent  examples/clinic-bookings/002_speed_up_lookups.sql:3',
  'ERROR    concurrently-in-transaction  examples/clinic-bookings/002_speed_up_lookups.sql:4',
  'ERROR    add-column-not-null-no-default  examples/clinic-bookings/003_patient_details.sql:2',
  'WARNING  add-column-volatile-default  examples/clinic-bookings/003_patient_details.sql:3',
  'WARNING  alter-column-type  examples/clinic-bookings/003_patient_details.sql:4',
  'WARNING  set-not-null  examples/clinic-bookings/003_patient_details.sql:5',
  'WARNING  add-constraint-without-not-valid  examples/clinic-bookings/003_patient_details.sql:7',
  'WARNING  rename-column  examples/clinic-bookings/004_cleanup.sql:2',
  'ERROR    drop-column  examples/clinic-bookings/004_cleanup.sql:3',
  'ERROR    drop-table  examples/clinic-bookings/004_cleanup.sql:4',
  'ERROR    truncate  examples/clinic-bookings/004_cleanup.sql:5',
  'ERROR    delete-without-where  examples/clinic-bookings/004_cleanup.sql:6',
  'ERROR    update-without-where  examples/clinic-bookings/004_cleanup.sql:7',
  'WARNING  lock-table-access-exclusive  examples/clinic-bookings/004_cleanup.sql:8',
  'WARNING  vacuum-full  examples/clinic-bookings/004_cleanup.sql:9',
  'WARNING  cluster  examples/clinic-bookings/004_cleanup.sql:10',
  'INFO     validate-constraint  examples/clinic-bookings/005_finishing_touches.sql:2',
  'WARNING  missing-terminator  examples/clinic-bookings/005_finishing_touches.sql:10',
  'GATE: FAIL - 7 errors'
], ['GATE: PASS', 'Room A', 'full_name']);

process.stdout.write('\n');
const fixedArgs = ['examples/clinic-bookings-fixed', '--since', '002_speed_up_lookups.sql', '--fail-on', 'warning'];
const fixed = await run(fixedArgs);
process.stdout.write(fixed.out);
expect('fixed migrations with --fail-on warning', fixed, 0, [
  'findings: 0 error, 0 warning, 3 info',
  'GATE: PASS (--fail-on warning)'
], ['ERROR', 'WARNING ']);

// The README shows the runs as they are printed.
const readme = (await readFile(resolve(root, 'README.md'), 'utf8')).split('\r\n').join('\n');
if (!readme.includes(failing.out)) problems.push('README: the sample output of the failing migrations differs from a real run');
if (!readme.includes(fixed.out)) problems.push('README: the sample output of the fixed migrations differs from a real run');

// The same migrations in the other formats, kept as examples of what each one looks like.
await mkdir(resolve(root, 'examples/output'), { recursive: true });
await writeFile(resolve(root, 'examples/output/clinic-bookings.txt'), failing.out);
for (const [format, name] of [['markdown', 'clinic-bookings.md'], ['json', 'clinic-bookings.json'], ['csv', 'clinic-bookings.csv']]) {
  const r = await run([...failingArgs, '--format', format]);
  if (r.code !== 1) problems.push(`${format}: exit code ${r.code}, expected 1`);
  await writeFile(resolve(root, 'examples/output', name), r.out);
}

if (problems.length) {
  for (const p of problems) console.error(`example: ${p}`);
  process.exit(1);
}
