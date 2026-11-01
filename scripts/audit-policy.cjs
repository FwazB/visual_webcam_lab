/* eslint-disable @typescript-eslint/no-require-imports -- Standalone Node CommonJS audit gate. */
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');

function validateAudit(report) {
  assert.equal(report.auditReportVersion, 2);
  assert.ok(!report.error && report.vulnerabilities && typeof report.vulnerabilities === 'object' && !Array.isArray(report.vulnerabilities));
  assert.deepEqual(Object.keys(report.vulnerabilities), [], 'Every dependency advisory must be remediated');
  assert.equal(report.metadata?.vulnerabilities?.total, 0);
  for (const severity of ['info', 'low', 'moderate', 'high', 'critical']) assert.equal(report.metadata.vulnerabilities[severity], 0);
  return 0;
}
module.exports = { validateAudit };
if (require.main === module) {
  const result = spawnSync('npm', ['audit', '--json'], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  process.stdout.write(result.stdout || '');
  process.stderr.write(result.stderr || '');
  assert.ok(!result.error && result.status === 0, 'npm audit failed or reported a vulnerability');
  validateAudit(JSON.parse(result.stdout));
  console.log('Full dependency audit: zero findings.');
}
