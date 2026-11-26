import { Capacitor, CapacitorHttp, registerPlugin } from '@capacitor/core';
import { App } from '@capacitor/app';
import './core.js';
import { boot } from './mobile-client.js';
import appConfig from '../app-config.json';
import { version as appVersion } from '../package.json';
import { installMobileUX } from './mobile-ux.js';
import { installMobileReminders } from './mobile-reminders.js';
import { installMobileToday } from './mobile-today.js';
import { installMobileCommute } from './mobile-commute.js';
import { installMobileMalls } from './mobile-malls.js';
import { installMobileBrowsers } from './mobile-browsers.js';
if (Capacitor.isNativePlatform()) {
  boot({ Http: CapacitorHttp, App, Files: registerPlugin('DaynestFiles'), defaultServer: appConfig.defaultServer, appVersion });
  installMobileUX();
  installMobileToday();
  installMobileCommute();
  installMobileMalls(registerPlugin('DaynestMaps'));
  installMobileBrowsers(registerPlugin('DaynestBrowsers'));
  installMobileReminders(App, registerPlugin('DaynestReminders'));
}
else document.addEventListener('DOMContentLoaded', () => { document.body.textContent = '这是 Android 打包资源，请通过 Go 服务打开网页版，或在 Android App 中运行。'; });
