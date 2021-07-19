const fs   = require('fs');
const path = require('path');

const WORKING_DIR = process.cwd();
const CONFIG_TYPE = fs.existsSync(path.join(WORKING_DIR, 'config.js')) ? 'js' : 'json';

module.exports = {
  WORKING_DIR,
  CONFIG_TYPE,

  BACKUP_DIR          : path.join(WORKING_DIR, 'backup'),
  PUBLIC_DIR          : path.join(WORKING_DIR, 'public'),
  MIDDLEWARE_DIR      : path.join(WORKING_DIR, 'middlewares'),
  CONFIG_FILE         : path.join(WORKING_DIR, `config.${CONFIG_TYPE}`),
  CONFIG_RUNTIME_FILE : path.join(WORKING_DIR, `config-runtime.${CONFIG_TYPE}`),


  RELOAD_ALL_WORKERS    : 'reload-all',
  RELOAD_ONE_WORKER     : 'reload',
  DRY_RELOAD_ONE_WORKER : 'dry-reload',
  SHUTDOWN_ONE_WORKER   : 'shutdown',

  // attribute used in req[UID] to store uid
  UID : Symbol('requestUID')
};
