/**
 * 「我的待办」本地服务。
 *
 * 两件事：
 *   1. 把网页当静态站点发出去（PWA 的离线缓存和「安装成应用」都要求 http(s)）。
 *   2. 提供 /api/data 存取待办数据，让手机和电脑之间同步。
 *
 * 两种用法：
 *   - 命令行：node server.js          （见文件末尾，默认只监听 127.0.0.1，LAN=1 开局域网）
 *   - 被内嵌：require('./server.js').createApp({...})
 *     桌面客户端（desktop/main.js）就是这么用的：服务跑在应用主进程里，
 *     用户看不到任何「服务器窗口」。
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8'
};

const MAX_BODY = 4 * 1024 * 1024;   // 待办再多也用不到 4MB

/**
 * 建一个服务实例。
 * @param {object} [options]
 * @param {string} [options.root]     静态文件根目录，默认本文件所在目录
 * @param {string} [options.dataDir]  数据目录，默认 <root>/data
 * @param {string} [options.host]     监听地址，默认 127.0.0.1
 * @param {number} [options.port]     端口，默认 8765（0 = 让系统随便分一个）
 */
function createApp(options) {
  const opts = options || {};
  const ROOT = opts.root || __dirname;
  const DATA_DIR = opts.dataDir || path.join(ROOT, 'data');
  const DATA_FILE = path.join(DATA_DIR, 'todo.json');

  /* ---------------- 数据存取 ---------------- */

  function readData() {
    try {
      const doc = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
      if (doc && Array.isArray(doc.tasks)) return doc.tasks;
    } catch (e) {
      if (e.code !== 'ENOENT') console.warn('读取数据失败，按空处理：', e.message);
    }
    return [];
  }

  // 两条待办谁更新：逐条「最后写入者获胜」。同一个 id 只保留较新的那条。
  // 注意：index.html 的 mergeTasks() 里有一份对应实现，改动时请一起改。
  function mergeTasks(a, b) {
    const byId = new Map();
    const put = (t) => {
      if (!t || typeof t.id !== 'string') return;
      const cur = byId.get(t.id);
      if (!cur || (Number(t.updatedAt) || 0) > (Number(cur.updatedAt) || 0)) byId.set(t.id, t);
    };
    a.forEach(put);
    b.forEach(put);
    return [...byId.values()];
  }

  // 先写临时文件再改名，避免写一半断电把数据写坏
  function writeData(tasks) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = DATA_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify({ tasks, savedAt: Date.now() }, null, 2), 'utf8');
    fs.renameSync(tmp, DATA_FILE);
  }

  /* ---------------- 响应helper ---------------- */

  function sendJson(res, code, obj) {
    const body = JSON.stringify(obj);
    res.writeHead(code, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'Content-Length': Buffer.byteLength(body)
    });
    res.end(body);
  }

  function send(res, code, type, body) {
    res.writeHead(code, { 'Content-Type': type });
    res.end(body);
  }

  function readBody(req) {
    return new Promise((resolve, reject) => {
      let size = 0;
      const chunks = [];
      req.on('data', (c) => {
        size += c.length;
        if (size > MAX_BODY) { reject(new Error('请求体过大')); req.destroy(); return; }
        chunks.push(c);
      });
      req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      req.on('error', reject);
    });
  }

  /* ---------------- 接口 ---------------- */

  async function handleApi(req, res, pathname) {
    if (pathname !== '/api/data') { sendJson(res, 404, { error: '没有这个接口' }); return; }

    if (req.method === 'GET') { sendJson(res, 200, { tasks: readData() }); return; }

    if (req.method === 'PUT' || req.method === 'POST') {
      let body;
      try { body = await readBody(req); }
      catch (e) { sendJson(res, 413, { error: e.message }); return; }

      let incoming;
      try { incoming = JSON.parse(body || '{}'); }
      catch (e) { sendJson(res, 400, { error: '不是合法的 JSON' }); return; }

      if (!incoming || !Array.isArray(incoming.tasks)) {
        sendJson(res, 400, { error: '缺少 tasks 数组' }); return;
      }

      // 与服务端已有数据合并后再存：两边各自离线改过也不会互相覆盖
      const before = readData();
      const merged = mergeTasks(before, incoming.tasks);
      if (process.env.TODO_LOG_PUSH === '1') {
        console.log(`[push] 收到 ${incoming.tasks.length} 条，服务端原有 ${before.length} 条，合并后 ${merged.length} 条` +
          ` | UA=${(req.headers['user-agent'] || '-').slice(0, 60)}`);
      }
      try { writeData(merged); }
      catch (e) { sendJson(res, 500, { error: '写入失败：' + e.message }); return; }

      sendJson(res, 200, { tasks: merged, savedAt: Date.now() });
      return;
    }

    sendJson(res, 405, { error: '只支持 GET / PUT' });
  }

  /* ---------------- 静态文件 ---------------- */

  function serveStatic(req, res, pathname) {
    if (pathname === '/') pathname = '/index.html';

    const file = path.resolve(ROOT, '.' + pathname);
    // 只允许访问本目录内的文件；data/ 里是数据，不走静态暴露
    if (file !== ROOT && !file.startsWith(ROOT + path.sep)) {
      return send(res, 403, 'text/plain; charset=utf-8', '403 越出目录');
    }
    if (file.startsWith(DATA_DIR + path.sep)) {
      return send(res, 403, 'text/plain; charset=utf-8', '403 不提供数据目录');
    }

    fs.readFile(file, (err, data) => {
      if (err) return send(res, 404, 'text/plain; charset=utf-8', '404 没有这个文件：' + pathname);
      res.writeHead(200, {
        'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
        // 每次都回源校验：改了 index.html 刷新即可见，配合 Service Worker 也不会拿到旧版
        'Cache-Control': 'no-cache',
        'Service-Worker-Allowed': '/'
      });
      res.end(data);
    });
  }

  const server = http.createServer((req, res) => {
    let pathname;
    try { pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); }
    catch (e) { return send(res, 400, 'text/plain; charset=utf-8', '400 请求格式错误'); }

    if (pathname.startsWith('/api/')) {
      handleApi(req, res, pathname).catch((e) => {
        console.error('接口出错：', e);
        if (!res.headersSent) sendJson(res, 500, { error: '服务器内部错误' });
      });
      return;
    }
    serveStatic(req, res, pathname);
  });

  return { server, root: ROOT, dataDir: DATA_DIR, dataFile: DATA_FILE };
}

module.exports = { createApp };

/* ---------------- 命令行入口 ---------------- */

if (require.main === module) {
  const PORT = Number(process.env.PORT) || 8765;
  const HOST = process.env.LAN === '1' ? '0.0.0.0' : (process.env.HOST || '127.0.0.1');
  const app = createApp();

  app.server.on('error', (e) => {
    if (e.code === 'EADDRINUSE') {
      console.error(`端口 ${PORT} 已被占用。`);
      console.error('可能「我的待办」已经在运行了，直接打开 http://127.0.0.1:' + PORT + '/ 即可；');
      console.error('换个端口：set PORT=9000 && node server.js');
    } else {
      console.error('启动失败：', e.message);
    }
    process.exit(1);
  });

  app.server.listen(PORT, HOST, () => {
    console.log('「我的待办」已启动： http://127.0.0.1:' + PORT + '/');
    if (HOST === '0.0.0.0') {
      const ips = Object.values(require('os').networkInterfaces()).flat()
        .filter((n) => n && n.family === 'IPv4' && !n.internal).map((n) => n.address);
      if (ips.length) {
        console.log('');
        console.log('  手机 / 其他设备用下面这个地址（同一个 WiFi）：');
        ips.forEach((ip) => console.log('    http://' + ip + ':' + PORT + '/'));
        console.log('');
        console.log('  提示：手机上通过局域网地址访问时，浏览器不给用离线缓存，');
        console.log('        所以装不成 App、离线打不开；同步功能不受影响。');
      } else {
        console.log('  没检测到局域网地址，请确认已连上 WiFi。');
      }
    }
    console.log('关闭此窗口即停止服务（已安装成应用后可离线使用，不必再开）。');
  });
}
