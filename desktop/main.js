/**
 * 「我的待办」桌面客户端主进程。
 *
 * 思路：把本地服务（../server.js）跑在这个主进程里，窗口加载 http://127.0.0.1:8765。
 * 这样应用既有原生窗口（没有地址栏、没有浏览器痕迹），
 * 又多设备同步、离线缓存这些依赖 http 环境的能力也全都在。
 * 用户看不到任何「服务器窗口」。
 */
const { app, BrowserWindow, Menu, shell, dialog, nativeTheme } = require('electron');
const path = require('path');
const os = require('os');

// 打包后 main.js 在 app.asar 里，'../server.js' 会被解析到 resources/server.js（不存在）；
// 打包时 server.js 是被 extraResources 放到 resources/app-web/ 的，这里要分情况取。
function loadServerModule() {
  const p = app.isPackaged
    ? path.join(process.resourcesPath, 'app-web', 'server.js')
    : path.join(__dirname, '..', 'server.js');
  try {
    return require(p);
  } catch (e) {
    dialog.showErrorBox('启动失败', '加载本地服务模块出错：\n' + p + '\n\n' + e.message);
    app.exit(1);
    return null;
  }
}

const { createApp } = loadServerModule();

const PORT = 8765;

let win = null;
let appServer = null;      // 我们自己起的服务实例
let ownsServer = false;    // false = 端口已被别的服务占用，直接复用那个
let lanMode = false;

/* ---------------- 路径 ---------------- */

function webRoot() {
  // 打包后静态文件在 resources/app-web；开发时就是项目根目录
  return app.isPackaged
    ? path.join(process.resourcesPath, 'app-web')
    : path.join(__dirname, '..');
}
function dataDir() {
  // 打包后应用目录可能只读，数据放用户数据目录；
  // 开发时放项目里，和命令行版共用同一份数据
  return app.isPackaged
    ? path.join(app.getPath('userData'), 'data')
    : path.join(webRoot(), 'data');
}
function iconPath() {
  return path.join(webRoot(), 'icons', 'app.ico');
}

/* ---------------- 内嵌服务 ---------------- */

function startServer(host) {
  return new Promise((resolve, reject) => {
    const inst = createApp({ root: webRoot(), dataDir: dataDir(), host, port: PORT });
    inst.server.once('error', reject);
    inst.server.listen(PORT, host, () => {
      inst.server.removeListener('error', reject);
      resolve(inst);
    });
  });
}

async function ensureServer() {
  try {
    appServer = await startServer('127.0.0.1');
    ownsServer = true;
  } catch (e) {
    if (e.code === 'EADDRINUSE') {
      ownsServer = false;          // 已经有服务在跑（比如命令行版），直接用它
    } else {
      dialog.showErrorBox('启动失败', '本地服务起不来：' + e.message);
      app.quit();
    }
  }
}

function lanAddresses() {
  return Object.values(os.networkInterfaces()).flat()
    .filter((n) => n && n.family === 'IPv4' && !n.internal)
    .map((n) => n.address);
}

/* ---------------- 窗口 ---------------- */

function createWindow() {
  const dark = nativeTheme.shouldUseDarkColors;
  win = new BrowserWindow({
    width: 1180,
    height: 880,
    minWidth: 360,
    minHeight: 480,
    title: '我的待办',
    icon: iconPath(),
    backgroundColor: dark ? '#000000' : '#F2F2F7',   // 免得深色下开窗先闪一下白
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false
    }
  });

  win.loadURL('http://127.0.0.1:' + PORT + '/');
  win.once('ready-to-show', () => win.show());       // 内容准备好再显示，不闪白
  win.on('closed', () => { win = null; });

  // 外部链接用系统浏览器打开，别在应用窗口里跳走
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
}

/* ---------------- 菜单 ---------------- */

async function toggleLan(menuItem) {
  const want = menuItem.checked;

  if (!ownsServer) {
    menuItem.checked = !want;
    dialog.showMessageBox(win, {
      type: 'info',
      message: '检测到已有另一个服务在运行，无法在这里切换局域网模式。',
      detail: '如果那是命令行版（启动局域网同步.bat），它本身就已经开着局域网了。'
    });
    return;
  }

  try {
    await new Promise((res, rej) => appServer.server.close((e) => (e ? rej(e) : res())));
    appServer = await startServer(want ? '0.0.0.0' : '127.0.0.1');
    lanMode = want;
  } catch (e) {
    menuItem.checked = !want;
    dialog.showErrorBox('切换失败', e.message);
    return;
  }

  if (want) {
    const ips = lanAddresses();
    dialog.showMessageBox(win, {
      type: 'info',
      title: '局域网同步已开启',
      message: ips.length
        ? '手机 / 其他设备在同一个 WiFi 下，用下面的地址打开：'
        : '没检测到局域网地址，请确认已连上 WiFi，然后用本机 IP 访问。',
      detail: (ips.map((ip) => 'http://' + ip + ':' + PORT + '/').join('\n') || '') +
        '\n\n注意：局域网内其他设备可以读写你的待办（数据不加密），请只在可信网络下开启。'
    });
  }
}

function buildMenu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {
      label: '文件',
      submenu: [
        {
          label: '允许手机访问（局域网同步）',
          type: 'checkbox',
          checked: lanMode,
          click: toggleLan
        },
        { label: '打开数据文件夹', click: () => shell.openPath(dataDir()) },
        { type: 'separator' },
        { role: 'quit', label: '退出' }
      ]
    },
    {
      label: '视图',
      submenu: [
        { role: 'reload', label: '重新加载' },
        { role: 'toggleDevTools', label: '开发者工具' },
        { type: 'separator' },
        { role: 'resetZoom', label: '实际大小' },
        { role: 'zoomIn', label: '放大' },
        { role: 'zoomOut', label: '缩小' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: '全屏' }
      ]
    },
    {
      label: '窗口',
      submenu: [
        { role: 'minimize', label: '最小化' },
        { role: 'close', label: '关闭窗口' }
      ]
    }
  ]));
}

/* ---------------- 生命周期 ---------------- */

// 只允许开一个实例：第二次双击就把已有窗口拉到前面
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  app.setAppUserModelId('local.mytodo.desktop');   // Windows 任务栏分组 / 通知要用

  app.whenReady().then(async () => {
    app.setName('我的待办');
    await ensureServer();
    buildMenu();
    createWindow();
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });

  app.on('window-all-closed', () => app.quit());

  app.on('before-quit', () => {
    if (appServer) {
      try { appServer.server.close(); } catch (e) {}
    }
  });
}
