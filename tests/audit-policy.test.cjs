/* eslint-disable @typescript-eslint/no-require-imports -- Tests the standalone CommonJS audit gate. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validateAudit } = require('../scripts/audit-policy.cjs');
const clean = () => ({ auditReportVersion: 2, vulnerabilities: {}, metadata: { vulnerabilities: { info: 0, low: 0, moderate: 0, high: 0, critical: 0, total: 0 } } });

test('audit accepts a complete zero-finding report', () => assert.equal(validateAudit(clean()), 0));
test('audit rejects the former development exception and every other severity', () => {
  for (const severity of ['info', 'low', 'moderate', 'high', 'critical']) {
    const report = clean();
    report.vulnerabilities.minimatch = { severity, via: [{ url: 'https://github.com/advisories/GHSA-g3hv-75wg-m249' }] };
    report.metadata.vulnerabilities.total = 1;
    assert.throws(() => validateAudit(report));
  }
});
test('audit rejects malformed, error, missing-total, and inconsistent reports', () => {
  for (const report of [{}, { ...clean(), error: { code: 'registry failure' } }, { ...clean(), auditReportVersion: 1 },
    { ...clean(), vulnerabilities: [] }, { ...clean(), vulnerabilities: true }, { ...clean(), vulnerabilities: 1 }, { ...clean(), metadata: {} },
    { ...clean(), metadata: { vulnerabilities: { total: 0 } } },
    { ...clean(), metadata: { vulnerabilities: { ...clean().metadata.vulnerabilities, high: 1 } } },
    { ...clean(), metadata: { vulnerabilities: { total: 1 } } },
    { ...clean(), vulnerabilities: { unexpected: {} } }]) assert.throws(() => validateAudit(report));
});
