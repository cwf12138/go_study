import { Capacitor, CapacitorHttp, registerPlugin } from '@capacitor/core';
import { App } from '@capacitor/app';
import './core.js';
import { boot } from './mobile-client.js';
if (Capacitor.isNativePlatform()) boot({ Http: CapacitorHttp, App, Files: registerPlugin('DaynestFiles') });
else document.addEventListener('DOMContentLoaded', () => { document.body.textContent = '这是 Android 打包资源，请通过 Go 服务打开网页版，或在 Android App 中运行。'; });
