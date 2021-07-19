const http = require('http');
const https = require('https');
const helper = require('./helper.js');

// TODO HTTPS : maxCachedSessions, augmenter le chiffr e100 pour avoir de meilleur perf
//require('http').globalAgent.maxSockets = 500
//
http.globalAgent.keepAlive = true;


const CONNECTION = 'connection';
const KEEP_ALIVE = 'keep-alive';
const PROXY_AUTHORIZATION = 'proxy-authorization';
const PROXY_CONNECTION = 'proxy-connection';
const TE = 'te';
const TRAILER = 'trailer';
const TRANSFER_ENCODING = 'transfer-encoding';
const UPGRADE = 'upgrade';
const HTTP2_SETTINGS = 'http2-settings';


const kReq = Symbol('req');
const kRes = Symbol('res');
const kSelf = Symbol('self');
const kProxyCallback = Symbol('callback');
const kProxyReq = Symbol('proxyReq');
const kProxyRes = Symbol('proxyRes');
const kProxySocket = Symbol('proxySocket');
const kOnProxyRes = Symbol('onProxyRes');
const kHead = Symbol('head');

function proxy (req, res, head, options, callback) {

  // TODO TEST (added from last version)
  // should we log
  if (req.aborted) {
    return;
  }

  const {
    hostname,
    port,
    protocol,
    path = req.originalUrl || req.url,
    timeout,
    proxyTimeout,
    proxyName,
    onReq,
    onRes
  } = options;

  req[kRes] = res;

  res[kReq] = req;
  res[kRes] = res;
  res[kSelf] = this;
  res[kProxyCallback] = callback;
  res[kProxyReq] = null;
  res[kProxySocket] = null;
  res[kHead] = head;
  res[kOnProxyRes] = onRes;

  const headers = helper.cloneHeaderForProxy(req);

  // add or overwrite custom header
  if (typeof(options.headers) === 'object') {
    for (let _name in options.headers) {
      headers[_name] = options.headers[_name];
    }
  }

  // only with websocket
  if (head !== undefined) {
    if (req.method !== 'GET') {
      process.nextTick(onComplete.bind(res), new HttpError('method not allowed', null, 405));
      return;
    }

    if (helper.sanitize(req.headers[UPGRADE]) !== 'websocket') {
      process.nextTick(onComplete.bind(res), new HttpError('bad request', null, 400));
      return;
    }

    if (head && head.length) {
      res.unshift(head);
    }

    setupSocket(res);

    headers[CONNECTION] = 'upgrade';
    headers[UPGRADE] = 'websocket';
  }

  // it must be !=
  if (timeout != null) { // eslint-disable-line
    req.setTimeout(timeout);
  }

  const reqOptions = {
    method  : req.method,
    hostname,
    port,
    path,
    headers,
    // agent : new http.Agent({ keepAlive : true }), TODO on peut passer par l'agent global 
    timeout : proxyTimeout
  };

  let agent = protocol === 'http' || protocol === 'ws' ? http : https;
  let proxyReq = agent.request(reqOptions);
  // TODO necesaary?
  // proxyReq.setSocketKeepAlive(true);

  proxyReq[kReq] = req;
  proxyReq[kRes] = res;
  res[kProxyReq] = proxyReq;

  res
    .on('close', onComplete)
    .on('finish', onComplete)
    .on('error', onComplete);

  req
    .on('close', onComplete)
    .on('aborted', onComplete)
    .on('error', onComplete)
    .on('timeout', onRequestTimeout)
    .pipe(proxyReq)
    .on('error', onProxyError)
    .on('timeout', onProxyTimeout)
    .on('response', onProxyResponse)
    .on('upgrade', onProxyUpgrade);

  return;
}

function onComplete (err) {
  const res = this[kRes];
  const req = res[kReq];

  const callback = res[kProxyCallback];

  // THe callback is called only ONCE (even if multiple event trigger onComplete)
  // So if the callback is undefined, leave immediately, the cleaning is already done
  if (!callback) {
    return;
  }

  const proxySocket = res[kProxySocket];
  const proxyRes = res[kProxyRes];
  const proxyReq = res[kProxyReq];

  res[kProxySocket] = undefined;
  res[kProxyRes] = undefined;
  res[kProxyReq] = undefined;
  res[kSelf] = undefined;
  res[kHead] = undefined;
  res[kOnProxyRes] = undefined;
  res[kProxyCallback] = undefined;

  res
    .removeListener('close', onComplete)
    .removeListener('finish', onComplete)
    .removeListener('error', onComplete);

  req
    .removeListener('close', onComplete)
    .removeListener('aborted', onComplete)
    .removeListener('error', onComplete)
    .removeListener('timeout', onRequestTimeout);

  if (proxySocket) {
    if (proxySocket.destroy) {
      // console.log('\nproxySocket DESTROY\n');
      proxySocket.destroy();
    }
  }

  if (proxyRes) {
    if (proxyRes.destroy) {
      // console.log('\nproxyRes DESTROY\n');
      proxyRes.destroy();
    }
  }

  if (proxyReq) {
    // proxyReq.off('drain', onProxyReqDrain);
    // abort request to backend
    // TODO should we  drain https://github.com/nxtedition/node-http2-proxy/blob/master/index.js#L168
    // 
    // proxyReq.abort is deprecated
    // if (proxyReq.abort) {
    //   console.log('\nproxyReq ABORT\n');
    //   proxyReq.abort();
    // }
    if (proxyReq.destroy) {
      // console.log('\nproxyReq DESTROY\n');
      // TODO, with keep Alive, keep ?
      // It is usually not necessary to do this. However, if using an agent with keepAlive enabled, then it is best to explicitly shut down the agent when it is no longer needed. 
      // Otherwise, sockets might stay open for quite a long time before the server terminates them.
      proxyReq.destroy();
    }
  }

  if (err) {
    err.statusCode = err.statusCode || 500;
    err.code = err.code || res.code;

    // proxy cannot be reached, end incoming socket (not automatic)
    if (err.statusCode === 502) {
      // res.end();
    }

    if (err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND') {
      err.statusCode = 503;
    }
    else if (/HPE_INVALID/.test(err.code)) {
      err.statusCode = 502;
    }
  }

  if (res[kHead] === undefined) {
    callback.call(res[kSelf], err, req, res, { proxyReq, proxyRes });
  }
  else {
    // websocket
    callback.call(res[kSelf], err, req, res, res[kHead], { proxyReq, proxyRes, proxySocket });
  }
}

function onProxyReqDrain () {
  this[kReq].resume();
}

function onRequestTimeout () {
  onComplete.call(this, new HttpError('request timeout', null, 408));
}

function onProxyError (err) {
  console.log('onProxyError');
  err.statusCode = 502;
  onComplete.call(this, err);
}

function onProxyTimeout () {
  onComplete.call(this, new HttpError('gateway timeout', null, 504));
}

function onProxyAborted () {
  onComplete.call(this, new HttpError('response aborted', 'ECONNRESET', 502));
}

function onProxyResponse (proxyRes) {
  const res = this[kRes];
  const req = res[kReq];

  res[kProxyRes] = proxyRes;
  proxyRes[kRes] = res;

  proxyRes
    .on('aborted', onProxyAborted)
    .on('error', onComplete);

  const headers = setupHeaders(proxyRes.headers);

  if (res[kOnProxyRes]) {
    try {
      res[kOnProxyRes].call(res[kSelf], req, res, proxyRes, err => onComplete.call(this, err));
    }
    catch (err) {
      onComplete.call(this, err);
    }
  }
  else if (!res.writeHead) {
    if (!proxyRes.upgrade) {
      res.write(helper.createHttpHeader(`HTTP/${proxyRes.httpVersion} ${proxyRes.statusCode} ${proxyRes.statusMessage}`, proxyRes.headers));
      proxyRes.pipe(res);
    }
  }
  else {
    res.statusCode = proxyRes.statusCode;
    for (const [ key, value ] of Object.entries(headers)) {
      res.setHeader(key, value);
    }
    proxyRes.pipe(res);
  }
}



function onProxyUpgrade (proxyRes, proxySocket, proxyHead) {
  const res = this[kRes];

  res[kProxySocket] = proxySocket;
  proxySocket[kRes] = res;

  setupSocket(proxySocket);

  if (proxyHead && proxyHead.length) {
    proxySocket.unshift(proxyHead);
  }

  res.write(helper.createHttpHeader('HTTP/1.1 101 Switching Protocols', proxyRes.headers));

  // TODO use pipeline, est-ce que ça premet d'enelver le res.end quand il y aune erreur de socket
  proxySocket
    .on('error', onComplete)
    .on('close', onProxyAborted)
    .pipe(res)
    .pipe(proxySocket);
}


function setupSocket (socket) {
  socket.setTimeout(0);
  socket.setNoDelay(true);
  socket.setKeepAlive(true, 0);
}

function setupHeaders (headers) {
  const connection = helper.sanitize(headers[CONNECTION]);

  if (connection && connection !== CONNECTION && connection !== KEEP_ALIVE) {
    for (const name of connection.split(',')) {
      delete headers[name.trim()];
    }
  }

  // Remove hop by hop headers
  delete headers[CONNECTION];
  delete headers[KEEP_ALIVE];
  delete headers[TRANSFER_ENCODING];
  delete headers[TE];
  delete headers[UPGRADE];
  delete headers[PROXY_AUTHORIZATION];
  delete headers[PROXY_CONNECTION];
  delete headers[TRAILER];
  delete headers[HTTP2_SETTINGS];

  return headers;
}


class HttpError extends Error {
  constructor (msg, code, statusCode) {
    super(msg);
    this.code = code;
    this.statusCode = statusCode || 500;
  }
}


module.exports = {

  ws (req, socket, head, options, callback) {
    return proxy.call(this, req, socket, head || null, options, callback);
  },
  web (req, res, options, callback) {
    return proxy.call(this, req, res, undefined, options, callback);
  }
};
