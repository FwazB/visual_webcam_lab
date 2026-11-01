/* eslint-disable @typescript-eslint/no-require-imports -- Standalone Node CommonJS audit gate. */
// Narrow, fail-closed implementation of the accepted development-only exception.
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { spawnSync } = require('node:child_process');
const allowed = new Set(['@eslint-community/eslint-utils', '@eslint/config-array', '@eslint/eslintrc', '@next/eslint-plugin-next', '@typescript-eslint/eslint-plugin', '@typescript-eslint/parser', '@typescript-eslint/type-utils', '@typescript-eslint/utils', 'eslint', 'eslint-config-next', 'eslint-plugin-import', 'eslint-plugin-jsx-a11y', 'eslint-plugin-react', 'minimatch', 'typescript-eslint']);
function validateAudit(report, lock) {
  assert.equal(report.auditReportVersion, 2);
  assert.ok(!report.error && report.vulnerabilities && lock.packages);
  const entries = Object.entries(report.vulnerabilities);
  assert.equal(report.metadata?.vulnerabilities?.total, entries.length);
  assert.ok(entries.length <= allowed.size);
  let advisoryCount = 0;
  for (const [name, finding] of entries) {
    assert.ok(allowed.has(name), `Unaccepted vulnerable dependency: ${name}`);
    assert.equal(finding.severity, 'moderate');
    assert.ok(Array.isArray(finding.nodes) && finding.nodes.length > 0);
    for (const node of finding.nodes) {
      assert.equal(lock.packages[node]?.dev, true, `Not dev-only: ${node}`);
      if (name === 'minimatch') assert.equal(lock.packages[node].version, '3.1.5');
    }
    assert.ok(Array.isArray(finding.via) && finding.via.length > 0);
    for (const via of finding.via) {
      if (typeof via === 'string') {
        assert.ok(report.vulnerabilities[via] && allowed.has(via), `Unknown audit edge: ${via}`);
      } else {
        assert.equal(name, 'minimatch');
        assert.equal(via.name, 'minimatch');
        assert.equal(via.dependency, 'minimatch');
        assert.equal(via.severity, 'moderate');
        assert.equal(via.url, 'https://github.com/advisories/GHSA-g3hv-75wg-m249');
        advisoryCount++;
      }
    }
  }
  assert.equal(advisoryCount, entries.length ? 1 : 0);
  return entries.length;
}
module.exports = { validateAudit };
if (require.main === module) {
  const result = spawnSync('npm', ['audit', '--json'], {encoding:'utf8', maxBuffer:16*1024*1024});
  process.stdout.write(result.stdout || '');
  process.stderr.write(result.stderr || '');
  assert.ok(!result.error && (result.status === 0 || result.status === 1), 'npm audit failed');
  const count = validateAudit(JSON.parse(result.stdout), JSON.parse(readFileSync('package-lock.json','utf8')));
  console.log(count ? `Accepted development exception: ${count} aggregate findings for GHSA-g3hv-75wg-m249; NOT a clean full audit.` : 'Full dependency audit: zero findings.');
}
