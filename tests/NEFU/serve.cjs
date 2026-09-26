// 只提供正式脚本和虚构测试资源，不开放仓库内的其他文件。
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const files = new Map([
  ['/', ['tests/NEFU/tests.html', 'text/html']],
  ['/tests/NEFU/tests.js', ['tests/NEFU/tests.js', 'text/javascript']],
  ['/resources/NEFU/nefu.js', ['resources/NEFU/nefu.js', 'text/javascript']]
]);
const server = http.createServer(async (request, response) => {
  const file = files.get(request.url);
  if (request.method !== 'GET' || !file) { response.writeHead(404); response.end(); return; }
  try {
    const content = await fs.readFile(path.join(root, file[0]));
    response.writeHead(200, {'Content-Type': file[1] + '; charset=utf-8', 'Cache-Control': 'no-store'});
    response.end(content);
  } catch { response.writeHead(500); response.end('Cannot load test resource'); }
});
server.listen(Number(process.env.PORT || 8766), '127.0.0.1', () => {
  console.log('NEFU tests: http://127.0.0.1:' + server.address().port + '/');
});
