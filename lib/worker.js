const http        = require('http');
const https       = require('https');
const cluster     = require('cluster');
const proxy       = require('./proxy');
const requestIp   = require('request-ip');
const url         = require('url');
const fs          = require('fs');
const path        = require('path');
const helper      = require('./helper');
const params      = require('./params');
const config       = require('./config');
const certificates = require('./certificates');
const { pipeline, finished } = require('stream');
const log         = helper.logger('APP');
const stat        = helper.logger('REQ');
let   serverAdmin = null;
let   serverHttp  = null;
let   serverHttps = null;
// certificates per domain
let defaultCertificates   = {};
let certificatesPerDomain = {};
let targetsPerDomain      = {};
let currentConfig         = {};

// without a global agent, connection is closed after each request, reducing performance (x 2)
// https://github.com/nodejitsu/node-http-proxy/issues/929
var keepAliveAgent = new http.Agent({ keepAlive : true });
// create the proxy
// var proxy = httpProxy.createProxyServer({
//   agent : keepAliveAgent
// });


/**
 * Process messages coming form master
 *
 * @param  {Object} msg
 */
function onPrimaryMessage (msg) {
  switch (msg) {
    case params.DRY_RELOAD_ONE_WORKER:
      readConfig(false) && process.send(params.RELOAD_ALL_WORKERS);
      break;
    case params.RELOAD_ONE_WORKER:
      readConfig(true);
      break;
    case params.SHUTDOWN_ONE_WORKER:
      log.info('Shutdown workers. Waiting remaining connections...');
      // TODO better manager if or use stopListening
      serverHttp.close(() => {
        serverHttps.close(() => {
          log.info('Exit');
          process.exit(0);
        });
      });
      break;
    default:
      break;
  }
}

/**
 * Starts a listening.
 */
function startListening () {
  // init SSL options for https.createServer function
  var sslOptions = {
    SNICallback : function (hostname, callback) {
      callback(null, certificatesPerDomain[hostname]);
    },
    // add default certificate when client does not provide SNI (mandatory)
    key  : defaultCertificates.privkey,
    cert : defaultCertificates.cert
  };

  if (currentConfig.portAdmin) {
    serverAdmin = http.createServer(handleAdminRequest);
    serverAdmin.listen(currentConfig.portAdmin);
    log.info(`Listen administration port ${currentConfig.portAdmin}`);
  }
  serverHttp  = http.createServer(handleRequest);
  serverHttps = https.createServer(sslOptions, handleRequest);
  serverHttp.listen(currentConfig.port);
  serverHttps.listen(currentConfig.portSSL);
  log.info(`Listen port ${currentConfig.port}`);
  log.info(`Listen port SSL ${currentConfig.portSSL}`);

  serverHttp.on('upgrade' , onUpgradeWS);
  serverHttps.on('upgrade', onUpgradeWS);
}

/**
 * Stops a listening.
 */
function stopListening () {
  if (serverHttp) {
    serverHttp.close();
  }
  if (serverHttps) {
    serverHttps.close();
  }
}

/**
 * Handle incoming request
 *
 * @param  {Object}  req     The request
 * @param  {Object}  res     The resource
 */
function handleRequest (req, res) {
  // set unique id for this request
  req[params.UID]      = helper.uid();
  var _hostWithoutPort = helper.getHostWithoutPort(req);
  var _target          = loadBalance(targetsPerDomain, _hostWithoutPort, req, res);
  var _ip              = requestIp.getClientIp(req);
  stat.info( _ip + '\t' + req.headers.host + '\t' + (_target !== undefined ? _target.url : 'unknown') + ' : ' + req.method + ' ' + req.url + '\t' + req[params.UID]);

  // if this an http request, without SSL
  if (req.connection.encrypted === undefined) {
    var _hasCertificate = certificatesPerDomain[_hostWithoutPort];
    // if this is a lets encrypt validation request
    if (/^\/.well-known\/acme-challenge/.test(req.url) === true) {
      return sendFilePublic(req, res);
    }
    // if there is a certificate for this domain, redirect the client to https
    if ( _hasCertificate !== undefined ) {
      // let _url = `https://${_hostWithoutPort}${(currentConfig.portSSL === 443 ? '' : ':' + currentConfig.portSSL)}/req.url);
      var _url = 'https://' + path.join(_hostWithoutPort + (currentConfig.portSSL === 443 ? '' : ':' + currentConfig.portSSL) , req.url);
      stat.info('redirect to ' + _url);
      res.writeHead(302, { Location : _url });
      return res.end();
    }
  }
  // if target is known, proxy it
  if (_target !== undefined) {
    const { port, hostname } = new URL(_target.url); // TODO REMOVE new URL
    // TODO manage htpt https, repalce slow new URL
    return proxy.web(req, res, {protocol : 'http', hostname : hostname, port : port, headers : _target.headers }, (err, rq, rs, hd, obj) => {
      if ( !err ) {
        return;
      }
      if (err.statusCode !== 503 &&  err.statusCode !== 502 || obj !== undefined /* a websocket */) { // TODO confirm
        return res.end();
      }
      // If it fails, try another backend in xx miliseconds
      var _retryTimeout = 50;
      var _otherTarget = loadBalance(targetsPerDomain, _hostWithoutPort, req, res, _target.url);
      stat.info('request-retry' + _ip + '\t' + req.headers.host + '\t' + _otherTarget.url + ' : ' + req.method + ' ' + req.url);
      // If the backend is the same, increase timeout
      if (_otherTarget.url === _target.url) {
        _retryTimeout = 10000;
      }
      setTimeout(() => {
        const { port, hostname } = new URL(_otherTarget.url); // TODO REMOVE new URL
        proxy.web(req, res, { protocol : 'http', hostname : hostname, port : port, headers : _target.headers }, (err) => {
          // TODO test
          if ( !err ) {
            return;
          }
          return res.end();
        });
      }, _retryTimeout);
    });
  }
  // otherwise return error
  stat.error('Unknown target for ' + _hostWithoutPort);
  res.writeHead(404, {'Content-Type' : 'text/plain'});
  res.end('Page not found');
}

/**
 * Listener for upgrade event
 * @param {Object} req
 * @param {Object} socket
 * @param {Object} head
 */
function onUpgradeWS (req, socket, head) {
  var _hostWithoutPort = helper.getHostWithoutPort(req);

  var _target = targetsPerDomain[_hostWithoutPort];
  if (_target === undefined || !(_target.backends instanceof Array) ) {
    return req.end();
  }
  _target = _target.backends[0];

  var _ip = requestIp.getClientIp(req);
  stat.info('[request-upgrade] ' + _ip + '\t' + req.headers.host + '\t' + _target.url + ' : ' + req.url);
  // return proxy.ws(req, socket, head, { target : _target.url, xfwd : true });
  const { port, hostname } = new URL(_target.url); // TODO REMOVE new URL
  return proxy.ws(req, socket, head, { protocol : 'ws', hostname : hostname, port : port, headers : _target.headers });
}

/**
 * If there are multiple backends, select the backend which have the least connection
 * to send the request
 *
 * @param  {Object} targetPerDomainConfig object from config
 * @param  {String} hostWithoutPort       hostname
 * @param  {Object} req
 * @param  {Object} res
 * @param  {Object} otherThan             avoid returning this backend URL is possible
 * @return {Object}                       target selected
 */
function loadBalance (targetPerDomainConfig, hostWithoutPort, req, res, otherThan) {
  var _target = targetPerDomainConfig[hostWithoutPort];
  if (_target === undefined || !(_target.backends instanceof Array) ) {
    return;
  }
  if (_target.backends.length === 1) {
    return _target.backends[0];
  }
  let _isVersionning = typeof(_target.versioning) === 'object' && typeof(_target.versioning.header) === 'string';
  let _wantedVersion = '';
  if (_isVersionning === true) {
    _wantedVersion = (req.headers[_target.versioning.header] !== undefined) ? req.headers[_target.versioning.header] : _target.versioning.default;
  }

  // If the target is an array of backend
  let _lowestValue = Number.MAX_SAFE_INTEGER;
  let _lowestConnectionBackend = 0;
  // select the backend which have the lowest value returned by loadBalancingFn (by default lowest number of connections)
  for (let i = 0; i < _target.backends.length; i++) {
    let _candidateBackend = _target.backends[i];
    if ( typeof(_target.loadBalancingFn ) === 'string' ) {
      _target.loadBalancingFn = new Function('req', 'backend', 'return (' + _target.loadBalancingFn + ')(req, backend);');
    }
    let _value = _target.loadBalancingFn(req, _candidateBackend);
    if (_value === Number.MIN_SAFE_INTEGER) {
      _lowestConnectionBackend = i;
      break;
    }
    if (_isVersionning === false || _candidateBackend.version === _wantedVersion) {
      if (_value < _lowestValue && _candidateBackend.isReady === true && _candidateBackend.url !== otherThan) {
        _lowestValue = _value;
        _lowestConnectionBackend = i;
      }
    }
  }
  // TODO manage if all server are not ready!
  let _chosenTarget = _target.backends[_lowestConnectionBackend];
  _chosenTarget.nbConnection++;

  res.on('finish', function () {
    _chosenTarget.nbConnection--;
    // protection when config is reloaded and if there are some closed connections later
    if (_chosenTarget.nbConnection < 0) {
      _chosenTarget.nbConnection = 0;
    }
  });

  return _chosenTarget;
}

// TODO c'est maintenant géré dans la callback du proxy.web et proxy.ws
// TODO gérer les headerSent dans le callback et vérifer que l'erreur est bien retournée
function handleError (err, req, res) {
  var _ip = requestIp.getClientIp(req);
  console.error('[request' + (!res.writeHead ? '-upgrade' : '') + '] ' +  _ip + ' -> ' + req.headers.host + ' :' + (!res.writeHead ? '' : ' ' + req.method) + ' ' + req.url);
  console.error(err);
  var _response = 'Internal server error';

  // WS res has no writeHead method
  if (!res.writeHead) {
    res.headersSent = true;
  }

  if (!res.headersSent) {
    // we must call writeHead only once. Do not send header if it has been already sent by the proxied app
    // if (req.xhr || req.headers.accept.indexOf('json') > -1) {
    //  res.writeHead(500, {'Content-Type': 'application/json'});
    //  _response = JSON.stringify({ success: false, error: 'Internal server error' });
    // } else {
    res.writeHead(500, {'Content-Type' : 'text/plain'});
    // }
  }
  return res.end(_response);
}

/**
 * Manage administration requests
 *
 * @param  {Object}  req  The request
 * @param  {Object}  res  The resource
 */
function handleAdminRequest (req, res) {
  const _method = req.method.toUpperCase();
  const _url    = url.parse(req.url, true);
  const _route  = _method + ' ' + _url.pathname;
  const _ip     = requestIp.getClientIp(req);
  log.info( _ip + '\t' + req.headers.host + '\t' + req.method + ' ' + req.url + '\t');
  switch (_route) {
    case 'GET /':
      helper.httpResponse(res, 200, 'GoHA Hello World\n');
      break;
    case 'GET /config':
      helper.httpResponse(res, 200, { data : currentConfig });
      break;
    case 'POST /config':
    case 'PUT /config':
      helper.getJSONData(req, (err, body) => {
        if (err) {
          return helper.httpResponse(res, 500, { message : err });
        }
        let _newConfig = body;
        if (_route.startsWith('PUT') === true ) {
          // merge mode
          _newConfig = config.merge(currentConfig, body);
        }
        if (!_newConfig) {
          return helper.httpResponse(res, 200, { message : 'Nothing to update' });
        }
        fs.writeFile(params.CONFIG_FILE, JSON.stringify(_newConfig, null, 2), (err) => {
          let _configStatus = readConfig(false, false); // try to reload config file
          if (err || _configStatus === false)  {
            return helper.httpResponse(res, 500, { message : 'Invalid configuration ' + err });
          }
          process.send(params.RELOAD_ALL_WORKERS);
          helper.httpResponse(res, 200, { data : _newConfig, message : 'The configuration will be updated in few seconds' });
        });
      });
      break;
    default:
      helper.httpResponse(res, 404, '404 Not Found\n');
  }
}

/**
 * When Lets Encrypt generate a certificate, it writes a file in ./public/.well-known/acme-challenge
 * We must return it, otherwise Lets Encrypt cannot validate the certificate
 */
// function sendFilePublic (req, res) {
//   let _uri = url.parse(req.url).pathname; // TODO replace
//   _uri = _uri.replace(/\.+/g, '.'); // security to avoid going up in hierarchy
//   let _filename = path.join(params.WORKING_DIR, 'public', _uri);
//
//   console.log('[request] LetsEncrypt trying to validate challenge: ', _filename);
//
//   fs.access(_filename, fs.constants.R_OK, function (err) {
//     if (err) {
//       console.error(err);
//       res.writeHead(404, {'Content-Type' : 'text/plain'});
//       res.write('404 Not Found\n');
//       return res.end();
//     }
//     res.writeHead(200);
//     fs.createReadStream(_filename, 'binary').pipe(res);
//   });
// }

function sendFilePublic (req, res) {
  let _uri = url.parse(req.url).pathname; // TODO replace
  _uri = _uri.replace(/\.+/g, '.'); // security to avoid going up in hierarchy
  let _filename = path.join(params.WORKING_DIR, 'public', _uri);

  stat.info(`Sending file ${_filename}\t${req[params.UID]}`);

  fs.access(_filename, fs.constants.R_OK, function (err) {
    if (err) {
      stat.error(`File ${_filename} not found\t${req[params.UID]}`);
      res.writeHead(404, {'Content-Type' : 'text/plain'});
      res.write('404 Not Found\n');
      return res.end();
    }
    res.writeHead(200);
    const _file = fs.createReadStream(_filename, 'binary');
    pipeline(_file, res, (err) => {
      if (err) {
        stat.error(`File ${_filename} not sent correctly\t${req[params.UID]}`);
      }
    });
  });
}


/**
 * Reads a configuration.
 *
 * @param      {boolean}  [isReadingRuntimeConfig=false]  Indicates if reading runtime configuration.
 *                        If false, it tries to read the new config file (not runtime one) without applying it
 * @return     {boolean}  true  if the configuration is valid
 *                        false if the configuration contains error
 */
function readConfig (isReadingRuntimeConfig = false, isUpdatingCertificate = true) {
  let _newCertificatesPerDomain = {};
  let _newDefaultCertificates = {};
  if (isUpdatingCertificate === true) {
    try {
      _newCertificatesPerDomain = certificates.getLetsEncryptCertificates();
      _newDefaultCertificates = certificates.getDefaultCertificate();
    }
    catch (e) {
      log.error('An error occurs when reading let\'s encrypt certificates or default certificates. ', e);
      log.error('Keep using in-memory let\'s encrypt certificates certificates');
      log.warn('Reload CANCELED');
      return false;
    }
  }

  let _newConfigParsed = config.getConfig(currentConfig, isReadingRuntimeConfig);
  if (!_newConfigParsed) {
    log.error('Config file is broken or does not contain any domain to listen');
    log.error('Fix config.js/json and try again');
    log.warn('Reload CANCELED');
    return false;
  }

  if (isReadingRuntimeConfig === true) {
    // apply config only if we read the runtime file
    currentConfig         = _newConfigParsed.configSource;
    targetsPerDomain      = _newConfigParsed.targetsPerDomain;
    log.info('Config reloaded with SUCCESS!');
    if (isUpdatingCertificate === true) {
      certificatesPerDomain = _newCertificatesPerDomain;
      defaultCertificates   =  _newDefaultCertificates;
      certificates.resolveWildcardCertificate(certificatesPerDomain, targetsPerDomain);
      log.info('Certificates reloaded with SUCCESS!');
    }
  }
  return true;
}


// Start automatically if it is worker (does not start in tests)
if (cluster.isWorker === true) {
  readConfig(true);
  startListening();
}
// listen messages coming from Primary process
process.on('message', onPrimaryMessage);


module.exports = {
  startListening,
  stopListening,
  handleRequest,
  onPrimaryMessage,
  // only for test purpose
  set targetsPerDomain (o)      { targetsPerDomain      = o; }, // eslint-disable-line
  set currentConfig (o)         { currentConfig         = o; }, // eslint-disable-line
  set certificatesPerDomain (o) { certificatesPerDomain = o; }, // eslint-disable-line
  set defaultCertificates (o)   { defaultCertificates   = o; }  // eslint-disable-line
};


