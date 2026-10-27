'use strict';
const { contextBridge } = require('electron');
// Only explicitly approved values are exposed to the page. Database access will be added here later via validated IPC.
contextBridge.exposeInMainWorld('appInfo', Object.freeze({ name: 'Japhet Stock Management System', author: 'Japhet Assey' }));
