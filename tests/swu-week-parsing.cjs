// Run with: node tests/swu-week-parsing.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const sourcePath = process.argv[2] || path.resolve(__dirname,
    '../resources/SWU/swu.js');
const source = fs.readFileSync(sourcePath, 'utf8').replace(/runImportFlow\(\);\s*$/, '');
const sandbox = { console: { log() {}, warn() {}, error() {} } };
vm.createContext(sandbox);
vm.runInContext(source, sandbox);
const weeks = value => Array.from(sandbox.parseWeeks(value));
assert.deepEqual(weeks('第7周'), [7]);
assert.deepEqual(weeks('第8周'), [8]);
assert.deepEqual(weeks('9-10周'), [9, 10]);
assert.deepEqual(weeks('11-12周'), [11, 12]);
assert.deepEqual(weeks('7,8,11,12周'), [7, 8, 11, 12]);
assert.deepEqual(weeks('第7、8、11、12周'), [7, 8, 11, 12]);
assert.deepEqual(weeks('第1-5周（单），6周'), [1, 3, 5, 6]);
assert.deepEqual(weeks('2-6周(双)'), [2, 4, 6]);
assert.deepEqual(weeks('7周,7周'), [7]);
for (const invalid of ['', null, '未安排', '7-3周', '0周', '7节', '7周补考']) {
    assert.deepEqual(weeks(invalid), [], `Unexpected weeks for ${invalid}`);
}
const courses = Array.from(sandbox.parseJsonData({ kbList: [
    { kcmc: '实验A', xqj: '5', jcs: '1-4', zcd: '第7周' },
    { kcmc: '实验A', xqj: '5', jcs: '1-4', zcd: '第8周' },
    { kcmc: '实验A', xqj: '5', jcs: '1-4', zcd: '9-10周' },
    { kcmc: '实验A', xqj: '5', jcs: '1-4', zcd: '11-12周' }
] }));
assert.equal(courses.length, 4);
assert.deepEqual(courses.flatMap(course => Array.from(course.weeks)), [7, 8, 9, 10, 11, 12]);
console.log('PASS: single-week experiments, comma lists, parity, invalid formats, and course staging');

