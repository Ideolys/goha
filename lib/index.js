const cluster = require('cluster');
const http = require('http');
const path = require('path');
const numCPUs = 2;

const FORCE_SHUTDOWN_TIMEOUT = 5000;
const WORKER_START_TIMEOUT = 5000;

const workers = new Set();

cluster.setupMaster({
  silent : false, // let us manage stdout and sterr of each worker in logger.js
  exec   : path.join(__dirname, '/worker.js') // set worker entry point
});


// cluster.on('fork', function (worker) {
//   worker.process.stdout.pipe(process.stdout);
//   worker.process.stderr.pipe(process.stdout);
// });

console.log(`[INFO] Primary ${process.pid} is running`);

// Fork workers.
for (let i = 0; i < numCPUs; i++) {
  cluster.fork();
}

let isRestartingWorkers = false;

process.on('SIGHUP', onSignalToReloadConfiguration);
cluster.on('exit'  , onWorkerExit);
cluster.on('online', onWorkerOnline); // TODO, listening ?

/**
 * Called on worker online.
 *
 * @param  {Object}  worker  The worker
 */
function onWorkerOnline (worker) {
  workers.add(worker);
  console.log(`[INFO] The worker ${worker.process.pid} responded after it was forked ${workers.size}`);
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
    console.log(`[INFO] Worker ${worker.process.pid} is gracefully exited by the primary`);
  }
  else {
    console.log(`[INFO] Worker ${worker.process.pid}  is not gracefully exited ${workers.size}`);
    cluster.fork();
  }
}

/**
 * Called on signal to reload configuration.
 */
function onSignalToReloadConfiguration () {
  if (isRestartingWorkers === true) {
    return;
  }
  isRestartingWorkers = true;
  gracefullyReplaceWorkers(Array.from(workers), (err) => {
    isRestartingWorkers = false;
    if (err) {
      return console.log('[INFO] Cannot reload configuration ' + err);
    }
    console.log('[INFO] Configuration reloaded\n');
  });
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
  worker.send('shutdown');
  // close all servers of the worker, wait for the 'close' event on those servers, and then disconnect the IPC channel.
  worker.disconnect();
  // if the server is still not dead after FORCE_SHUTDOWN_TIMEOUT milliseconds, kill it
  const _timeout = setTimeout(worker.kill, FORCE_SHUTDOWN_TIMEOUT);
  worker.on('disconnect', () => {
    clearTimeout(_timeout);
    callback();
  });
}


