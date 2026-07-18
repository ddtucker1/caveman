/**
 * Wildborn — Electron main process.
 * Loads the same Canvas game as a native desktop window (no browser chrome).
 */
const { app, BrowserWindow, Menu } = require('electron');
const path = require('path');

/** @type {BrowserWindow | null} */
let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    title: 'Wildborn',
    backgroundColor: '#1a1f16',
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // Game assets are local scripts; keep file:// loads simple.
      webSecurity: true,
    },
  });

  // Minimal menu: keep DevTools available in non-packaged builds.
  const isDev = !app.isPackaged;
  const template = [
    {
      label: 'Wildborn',
      submenu: [
        { role: 'quit' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'togglefullscreen' },
        ...(isDev
          ? [
              { type: 'separator' },
              { role: 'reload' },
              { role: 'toggleDevTools' },
            ]
          : []),
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));

  mainWindow.loadFile(path.join(__dirname, '..', 'index.html'));

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
