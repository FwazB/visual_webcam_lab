/* eslint-disable @typescript-eslint/no-require-imports -- Tests the standalone CommonJS audit gate. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validateAudit } = require('../scripts/audit-policy.cjs');
const advisory = { name:'minimatch', dependency:'minimatch', severity:'moderate', url:'https://github.com/advisories/GHSA-g3hv-75wg-m249' };
const report = () => ({ auditReportVersion:2, vulnerabilities:{minimatch:{name:'minimatch',severity:'moderate',via:[{...advisory}],nodes:['node_modules/minimatch']}},metadata:{vulnerabilities:{total:1}} });
const lock = () => ({packages:{'node_modules/minimatch':{version:'3.1.5',dev:true}}});
test('audit exception accepts only the recorded dev minimatch finding',()=>assert.equal(validateAudit(report(),lock()),1));
test('audit accepts clean report',()=>assert.equal(validateAudit({auditReportVersion:2,vulnerabilities:{},metadata:{vulnerabilities:{total:0}}},lock()),0));
test('audit rejects new advisory even when moderate',()=>{const r=report();r.vulnerabilities.minimatch.via[0].url='https://github.com/advisories/GHSA-new';assert.throws(()=>validateAudit(r,lock()));});
test('audit rejects production or changed minimatch version',()=>{for(const change of [{dev:false},{version:'3.1.6'}]){const l=lock();Object.assign(l.packages['node_modules/minimatch'],change);assert.throws(()=>validateAudit(report(),l));}});
test('audit rejects malformed/error reports and missing dependency paths',()=>{for(const r of [{},{error:{code:'registry failure'}},{auditReportVersion:2,vulnerabilities:{}}])assert.throws(()=>validateAudit(r,lock()));assert.throws(()=>validateAudit(report(),{packages:{}}));});
test('audit rejects upgraded severity or unresolved dependency edges',()=>{let r=report();r.vulnerabilities.minimatch.severity='high';assert.throws(()=>validateAudit(r,lock()));r=report();r.vulnerabilities.minimatch.via=['unknown'];assert.throws(()=>validateAudit(r,lock()));});
