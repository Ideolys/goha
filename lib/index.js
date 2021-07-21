const cluster = require('cluster');
const fs          = require('fs');
const path        = require('path');
const params        = require('./params');
const helper        = require('./helper');
const certificates  = require('./certificates');
const log           = helper.logger('APP');
const numCPUs       = require('os').cpus().length;

const FORCE_SHUTDOWN_TIMEOUT = 5000;
const WORKER_START_TIMEOUT   = 5000;
const workers = new Set();

let   isRestartingWorkers = false;
let   isUpdatingConfiguration = false;

// By default, Node alerts when more than 10 listeners are added for the same event
// It happens with cluster.on('fork') if GoHA is started on a mahcine with more than 10 cores
// const { EventEmitter } = require('events');
// const ee = new EventEmitter();
// ee.setMaxListeners(50);

/**
 * Init working directory
 *
 */
function initWorkingDirectory () {
  // must be 700 instead of 600 to allow search
  try { fs.mkdirSync(params.BACKUP_DIR     , { recursive: true, mode: 0o770 }); } catch (e) {}; // eslint-disable-line
  try { fs.mkdirSync(params.PUBLIC_DIR     , { recursive: true, mode: 0o770 }); } catch (e) {}; // eslint-disable-line
  try { fs.mkdirSync(params.MIDDLEWARE_DIR , { recursive: true, mode: 0o770 }); } catch (e) {}; // eslint-disable-line
  certificates.createDefault();

  // create config file if it does not exists
  const _defaultConfig = {
    port    : 3002,
    portSSL : 4443,
    domains : {
      'mydomain.net' : 'http://121.0.0.1:3003'
    }
  };
  if (fs.existsSync(params.CONFIG_FILE) === false) {
    fs.writeFileSync(params.CONFIG_FILE, JSON.stringify(_defaultConfig, null, 2), { mode : 0o770 });
  }
  if (fs.existsSync(params.CONFIG_RUNTIME_FILE) === false) {
    fs.copyFileSync(params.CONFIG_FILE, params.CONFIG_RUNTIME_FILE);
  }
}


function start () {
  cluster.setupMaster({
    silent : true, // let the master manage stdout and sterr of each worker
    exec   : path.join(__dirname, 'worker.js') // set worker entry point
  });

  log.info('Primary is running. Starting workers...');

  for (let i = 0; i < numCPUs; i++) {
    cluster.fork();
  }

  process.on('SIGHUP' , restartWorkers);
  process.on('SIGUSR2', updateConf);
  cluster.on('message', onWorkerMessage);
  cluster.on('exit'   , onWorkerExit);
  cluster.on('online' , onWorkerOnline); // TODO, listening ?
  // Pipe stdout of each worker to make it asynchronuous (improve performance)
  // and avoid collision if each worker write directly in TTY/file.
  // Works only if "silent : true" is used in setupMaster
  cluster.on('fork', function (worker) {
    worker.process.stdout.pipe(process.stdout);
    worker.process.stderr.pipe(process.stdout);
  });
}


/**
 * Called on worker online.
 *
 * @param  {Object}  worker  The worker
 */
function onWorkerOnline (worker) {
  workers.add(worker);
  // worker.send('start'); //useless ?
  log.info(`The worker ${worker.process.pid} responded after it was forked ${workers.size}`);
}

/**
 * Called on cluster exit.
 *
 * @param  {Object>}  worker  The worker
 * @param  {String}   code    The code
 * @param  {String}   signal  The signal
 */
function onWorkerExit (worker, code, signal) {
  workers.delete(worker); // remove it from the list of workers
  if (worker.exitedAfterDisconnect === true) {
    log.info(`Worker ${worker.process.pid} is gracefully exited by the primary`);
  }
  else {
    log.info(`Worker ${worker.process.pid}  is not gracefully exited ${workers.size}`);
    cluster.fork();
  }
}

/**
 * Called on signal to reload configuration.
 */
function restartWorkers () {
  if (isRestartingWorkers === true) {
    return;
  }
  isRestartingWorkers = true;
  gracefullyReplaceWorkers(Array.from(workers), (err) => {
    isRestartingWorkers = false;
    if (err) {
      return log.info('Cannot reload configuration ' + err);
    }
    log.info('Configuration reloaded\n');
  });
}


/**
 * Called on signal to reload configuration.
 */
function updateConf () {
  let _oneWorker = workers.values().next().value;
  _oneWorker.send(params.DRY_RELOAD_ONE_WORKER);
}

/**
 * Called on worker message.
 *
 * @param   {Object}  msg   The worker instance
 * @param   {String}  msg   The message coming from one worker
 */
function onWorkerMessage (worker, msg) {
  if (msg === params.RELOAD_ALL_WORKERS) {
    log.info('Reload configuration for all workers');
    try {
      // backup current config
      const _backupFile = `${(new Date()).toISOString()}-config.${params.CONFIG_TYPE}`;
      log.info(`Backup old configuration to ${_backupFile}.`);
      fs.copyFileSync(params.CONFIG_RUNTIME_FILE, path.join(params.BACKUP_DIR, _backupFile ));
      log.info(`Copy config to ${params.CONFIG_RUNTIME_FILE}.`);
      fs.copyFileSync(params.CONFIG_FILE, params.CONFIG_RUNTIME_FILE);
    }
    catch (e) {
      return log.warn('Reload CANCELED. Cannot backup current config. '+e );
    }
    let _reloadInterval = 500;
    log.info('Update all workers with new configuration');
    for (let worker of workers) {
      worker.send(params.RELOAD_ONE_WORKER);
      // setTimeout(worker.send, _reloadInterval, 'reload');
      _reloadInterval +=_reloadInterval;
    }
  }
}


/**
 * Gracefully stop and start workers
 *
 * @param  {Array}     workerToReplace   workers to replace
 * @param  {Function}  callback(err)     When the process is finished
 */
function gracefullyReplaceWorkers (workerToReplace, callback) {
  if (workerToReplace.length === 0) {
    return callback();
  }
  // Start a new worker first
  const _newWorker  = cluster.fork();
  // kill and stop the process if the start is too long
  const _startTimeout = setTimeout(onWorkerStartTimeout, WORKER_START_TIMEOUT, _newWorker, callback);
  // When the new worker is ready, kill old one
  _newWorker.on('listening', () => {
    clearTimeout(_startTimeout);
    shutdownWorker(workerToReplace.pop(), () => gracefullyReplaceWorkers(workerToReplace, callback));
  });
}

/**
 * Called on worker start timeout.
 *
 * @param  {Object}    newWorker  The new worker
 * @param  {Function}  callback   The callback
 */
function onWorkerStartTimeout (newWorker, callback) {
  newWorker.kill();
  workers.delete(newWorker); // should be useless because remove by onExit by we never know
  callback(new Error('Cannot start new worker. Keep old worker'));
}

/**
 * Shutdown worker gracefully
 *
 * @param  {Object}    worker    The worker
 * @param  {Function}  callback  The callback
 */
function shutdownWorker (worker, callback) {
  // send a signal to the worker, so it can close remaining socket connection (not closed by the command below)
  worker.send(params.SHUTDOWN_ONE_WORKER);
  // close all servers of the worker, wait for the 'close' event on those servers, and then disconnect the IPC channel.
  worker.disconnect();
  // if the server is still not dead after FORCE_SHUTDOWN_TIMEOUT milliseconds, kill it
  const _timeout = setTimeout(worker.kill, FORCE_SHUTDOWN_TIMEOUT);
  worker.on('disconnect', () => {
    clearTimeout(_timeout);
    callback();
  });
}

// init working dir
initWorkingDirectory();
// start system
start();
// update conf
setTimeout(updateConf, 1000);


