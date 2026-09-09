/**
 * Desktop shell for the Erode Examination Duty Allotment System.
 *
 * The window is a thin frame around the same local API server used by
 * `npm run api:local`, which also serves the built SPA, so the packaged app is
 * the product rather than a second implementation. Everything stays on
 * loopback: no Cloudflare, no network calls, SQLite under the OS app-data dir.
 */
const { app, BrowserWindow, dialog, shell, Menu } = require("electron");
const { autoUpdater } = require("electron-updater");
const { spawn } = require("node:child_process");
const { existsSync, mkdirSync } = require("node:fs");
const { join } = require("node:path");
const net = require("node:net");

const isPackaged = app.isPackaged;
const resourceDir = isPackaged
  ? join(process.resourcesPath, "app-resources")
  : join(__dirname, "..");
// Kept inside the app bundle so `require("better-sqlite3")` resolves against
// the packaged node_modules; its N-API prebuild is asar-unpacked at build time.
const serverEntry = join(app.getAppPath(), "desktop", "dist", "api-server.cjs");
// desktop/ui is built with VITE_DESKTOP=1; frontend/dist stays the hosted bundle.
const staticDir = isPackaged
  ? join(process.resourcesPath, "app-resources", "ui")
  : join(__dirname, "ui");

let serverProcess = null;
let appUrl = null;

/**
 * GitHub Releases updates are deliberately confirmation-first: the app never
 * downloads or restarts itself without the operator choosing each action.
 * This runs only from an installed, packaged build; development work stays
 * fully offline and does not attempt to contact GitHub.
 */
function enableAutomaticUpdates(win) {
  if (!isPackaged) return;

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;

  autoUpdater.on("update-available", (info) => {
    void dialog.showMessageBox(win, {
      type: "info",
      title: "Update available",
      message: `Version ${info.version} is ready to download.`,
      detail: "The download will come from the official Erode Exam Duty GitHub release. Your local data will remain on this computer.",
      buttons: ["Download update", "Later"],
      defaultId: 0,
      cancelId: 1,
    }).then(({ response }) => {
      if (response === 0) {
        void autoUpdater.downloadUpdate().catch((error) => {
          console.error("Could not download update", error);
        });
      }
    });
  });

  autoUpdater.on("download-progress", ({ percent }) => {
    win.setProgressBar(Math.max(0, Math.min(percent / 100, 1)));
  });

  autoUpdater.on("update-downloaded", (info) => {
    win.setProgressBar(-1);
    void dialog.showMessageBox(win, {
      type: "info",
      title: "Update downloaded",
      message: `Version ${info.version} is ready to install.`,
      detail: "Choose Install and restart to close the app and finish the update. Your saved data will not be removed.",
      buttons: ["Install and restart", "Later"],
      defaultId: 0,
      cancelId: 1,
    }).then(({ response }) => {
      if (response === 0) autoUpdater.quitAndInstall(false, true);
    });
  });

  // An unavailable network or an unpublished release must not prevent normal
  // offline duty-allotment work. Diagnostics remain available in the app log.
  autoUpdater.on("error", (error) => {
    win.setProgressBar(-1);
    console.error("Update check failed", error);
  });

  void autoUpdater.checkForUpdates().catch((error) => {
    console.error("Could not check for updates", error);
  });
}

function dataDir() {
  const dir = join(app.getPath("userData"), "data");
  mkdirSync(dir, { recursive: true });
  return dir;
}

function freePort() {
  return new Promise((resolveP, rejectP) => {
    const srv = net.createServer();
    srv.on("error", rejectP);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolveP(port));
    });
  });
}

function startServer(port) {
  return new Promise((resolveP, rejectP) => {
    if (!existsSync(serverEntry)) {
      rejectP(
        new Error(
          `Server bundle missing at ${serverEntry}. Run: npm run desktop:bundle`,
        ),
      );
      return;
    }
    serverProcess = spawn(process.execPath, [serverEntry], {
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: "1",
        API_PORT: String(port),
        API_HOST: "127.0.0.1",
        APP_DATA_DIR: dataDir(),
        APP_RESOURCE_DIR: resourceDir,
        APP_STATIC_DIR: staticDir,
        ENVIRONMENT: "development",
        DESKTOP_SINGLE_USER: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let settled = false;
    let stderr = "";
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        rejectP(new Error(`Server did not start in 30s.\n${stderr.slice(-2000)}`));
      }
    }, 30_000);

    serverProcess.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      process.stdout.write(`[server] ${text}`);
      const match = /APP_READY (\S+)/.exec(text);
      if (match && !settled) {
        settled = true;
        clearTimeout(timer);
        resolveP(match[1]);
      }
    });
    serverProcess.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
      process.stderr.write(`[server] ${chunk}`);
    });
    serverProcess.on("exit", (code) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        rejectP(new Error(`Server exited with code ${code}.\n${stderr.slice(-2000)}`));
      }
    });
  });
}

function createWindow(url) {
  const win = new BrowserWindow({
    width: 1500,
    height: 950,
    minWidth: 420,
    backgroundColor: "#f4f7fb",
    title: "Erode Exam Duty",
    // Packaged builds take the icon from the bundle; dev runs need it explicitly.
    ...(isPackaged ? {} : { icon: join(__dirname, "build", "icon.png") }),
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // Duty orders and reports open in the operator's browser, not a bare window.
  win.webContents.setWindowOpenHandler(({ url: target }) => {
    void shell.openExternal(target);
    return { action: "deny" };
  });

  void win.loadURL(url);
  return win;
}

function buildMenu() {
  const template = [
    {
      label: "File",
      submenu: [
        {
          label: "Open data folder",
          click: () => void shell.openPath(dataDir()),
        },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { role: "togglefullscreen" },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// One window per install: two shells on one SQLite file would race.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    const [win] = BrowserWindow.getAllWindows();
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  app.whenReady().then(async () => {
    buildMenu();
    try {
      const port = Number(process.env.API_PORT ?? 0) || (await freePort());
      appUrl = await startServer(port);
      const win = createWindow(appUrl);
      setTimeout(() => enableAutomaticUpdates(win), 5_000);
    } catch (e) {
      dialog.showErrorBox(
        "Erode Exam Duty could not start",
        e instanceof Error ? e.message : String(e),
      );
      app.quit();
    }

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0 && appUrl) {
        createWindow(appUrl);
      }
    });
  });

  app.on("window-all-closed", () => {
    app.quit();
  });

  app.on("before-quit", () => {
    if (serverProcess && !serverProcess.killed) {
      serverProcess.kill();
    }
  });
}
