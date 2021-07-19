const httpProxy = require('../lib/proxy');
const helper    = require('../lib/helper.js');
const http      = require('http');
const ws        = require('ws');
const ioServer  = require('socket.io').Server;
const ioClient  = require('socket.io-client');

describe('proxy with websocket', function () {
  it('should proxy the websockets stream', function (done) {

    var proxyServer = http.createServer();
    proxyServer.listen(3000);
    proxyServer.on('upgrade', (req, socket, head) => {
      httpProxy.ws(req, socket, head, {
        protocol : 'ws',
        hostname : '127.0.0.1',
        port     : 1024
      });
    });

    var destiny = new ws.Server({ port : 1024 }, function () {
      var client = new ws('ws://127.0.0.1:' + 3000);

      client.on('open', function () {
        client.send('hello there');
      });

      client.on('message', function (msg) {
        helper.eq(msg, 'Hello over websockets');
        client.close();
        proxyServer.close();
        destiny.close();
        done();
      });
    });

    destiny.on('connection', function (socket) {
      socket.on('message', function (msg) {
        helper.eq(msg, 'hello there');
        socket.send('Hello over websockets');
      });
    });
  });

  it('should return error on proxy error and end client connection', function (done) {
    const proxyServer = http.createServer();
    proxyServer.listen(3000);
    proxyServer.on('upgrade', (req, socket, head) => {
      httpProxy.ws(req, socket, head, { protocol : 'ws', hostname : '127.0.0.1', port : 1024 }, onProxyEndCallback);
    });

    function onProxyEndCallback (err, req, res) {
      helper.eq(err instanceof Error, true);
      helper.eq(err.code, 'ECONNREFUSED');
      res.end();
      proxyServer.close();
      maybeDone();
    }

    var client = new ws('ws://127.0.0.1:' + 3000);

    client.on('open', function () {
      client.send('hello there');
    });

    var count = 0;
    function maybeDone () {
      count += 1;
      if (count === 2) {
        done();
      }
    }

    client.on('error', function (err) {
      helper.eq(err instanceof Error, true);
      helper.eq(err.code, 'ECONNRESET');
      maybeDone();
    });
  });

  it('should close client socket if upstream is closed before upgrade', function (done) {
    const proxyServer = http.createServer();
    proxyServer.listen(3000);
    proxyServer.on('upgrade', (req, socket, head) => {
      httpProxy.ws(req, socket, head, { protocol : 'ws', hostname : '127.0.0.1', port : 1024 });
    });

    var server = http.createServer();
    server.on('upgrade', function (req, socket) {
      var response = [
        'HTTP/1.1 404 Not Found',
        'Content-type: text/html',
        '',
        ''
      ];
      socket.write(response.join('\r\n'));
      socket.end();
    });
    server.listen(1024);

    var client = new ws('ws://127.0.0.1:' + 3000);

    client.on('open', function () {
      client.send('hello there');
    });

    client.on('error', function (err) {
      helper.eq(err instanceof Error, true);
      proxyServer.close();
      server.close();
      done();
    });
  });

  it('should proxy a socket.io stream', function (done) {
    var nbHttpRequest = 0;
    const proxyServer = http.createServer((req, res) => {
      nbHttpRequest++; // we should receive no requests
      httpProxy.web(req, res, { protocol : 'http', hostname : '127.0.0.1', port : 1024 });
    });
    proxyServer.listen(3000);
    // accept websocket proxy
    proxyServer.on('upgrade', (req, socket, head) => {
      httpProxy.ws(req, socket, head, { protocol : 'ws', hostname : '127.0.0.1', port : 1024 });
    });

    var server = http.createServer();
    var destiny = new ioServer(server);

    function startSocketIo () {
      const client = ioClient('ws://127.0.0.1:' + 3000, { transports : ['websocket'] });

      client.on('connect', function () {
        client.emit('incoming', 'hello there');
      });

      client.on('outgoing', function (data) {
        helper.eq(data, 'Hello over websockets');
        helper.eq(nbHttpRequest, 0);
        proxyServer.close();
        server.close();
        done();
      });
    }
    server.listen(1024);
    server.on('listening', startSocketIo);

    destiny.on('connection', function (socket) {
      socket.on('incoming', function (msg) {
        helper.eq(msg, 'hello there');
        socket.emit('outgoing', 'Hello over websockets');
      });
    });
  });


  it.skip('should emit open and close events when socket.io client connects and disconnects', function (done) {
    const proxyServer = http.createServer((req, res) => {
      httpProxy.web(req, res, { protocol : 'http', hostname : '127.0.0.1', port : 1024 });
    });
    proxyServer.listen(3000);
    // accept websocket proxy
    proxyServer.on('upgrade', (req, socket, head) => {
      httpProxy.ws(req, socket, head, { protocol : 'ws', hostname : '127.0.0.1', port : 1024 });
    });

    var server = http.createServer();
    var destiny = new ioServer(server);

    function startSocketIo () {
      const client = ioClient.connect('ws://127.0.0.1:' + 3000, { transports : ['websocket'] , rejectUnauthorized : null });
      // var client = ioClient.connect('ws://127.0.0.1:' + 3000, {rejectUnauthorized : null});
      client.on('connect', function () {
        client.disconnect();
      });
    }
    var count = 0;

    proxyServer.on('open', function () {
      count += 1;

    });

    proxyServer.on('close', function () {
      proxyServer.close();
      server.close();
      destiny.close();
      if (count == 1) {
        done();
      }
    });

    server.listen(1024);
    server.on('listening', startSocketIo);

  });

  it('should pass all set-cookie headers to client', function (done) {
    const proxyServer = http.createServer();
    proxyServer.listen(3000);
    // accept websocket proxy
    proxyServer.on('upgrade', (req, socket, head) => {
      httpProxy.ws(req, socket, head, { protocol : 'ws', hostname : '127.0.0.1', port : 1024 });
    });

    var destiny = new ws.Server({ port : 1024 }, function () {
      var key = Buffer.from(Math.random().toString()).toString('base64');

      var requestOptions = {
        port    : 3000,
        host    : '127.0.0.1',
        headers : {
          Connection              : 'Upgrade',
          Upgrade                 : 'websocket',
          Host                    : 'ws://127.0.0.1',
          'Sec-WebSocket-Version' : 13,
          'Sec-WebSocket-Key'     : key
        }
      };

      var req = http.request(requestOptions);

      req.on('upgrade', function (res) {
        helper.eq(res.headers['set-cookie'].length, 2);
        proxyServer.close();
        destiny.close();
        done();
      });

      req.end();
    });

    destiny.on('headers', function (headers) {
      headers.push('Set-Cookie: test1=test1');
      headers.push('Set-Cookie: test2=test2');
    });
  });

  it('should modify headers', function (done) {
    var destiny;

    const proxyServer = http.createServer();
    proxyServer.listen(3000);
    // accept websocket proxy
    proxyServer.on('upgrade', (req, socket, head) => {
      httpProxy.ws(req, socket, head, {
        protocol : 'ws',
        hostname : '127.0.0.1',
        port     : 1024,
        headers  : {
          'X-Special-Proxy-Header' : 'foobar'
        }
      });
    });

    destiny = new ws.Server({ port : 1024 }, function () {
      var client = new ws('ws://127.0.0.1:' + 3000);

      client.on('open', function () {
        client.send('hello there');
      });

      client.on('message', function (msg) {
        helper.eq(msg, 'Hello over websockets');
        client.close();
        proxyServer.close();
        destiny.close();
        done();
      });
    });

    destiny.on('connection', function (socket, upgradeReq) {
      helper.eq(upgradeReq.headers['x-special-proxy-header'], 'foobar');
      socket.on('message', function (msg) {
        helper.eq(msg, 'hello there');
        socket.send('Hello over websockets');
      });
    });
  });

  it('should forward frames with single frame payload', function (done) {
    var payload = Array(65529).join('0');

    const proxyServer = http.createServer();
    proxyServer.listen(3000);
    // accept websocket proxy
    proxyServer.on('upgrade', (req, socket, head) => {
      httpProxy.ws(req, socket, head, { protocol : 'ws', hostname : '127.0.0.1', port : 1024 });
    });

    var destiny = new ws.Server({ port : 1024 }, function () {
      var client = new ws('ws://127.0.0.1:' + 3000);

      client.on('open', function () {
        client.send(payload);
      });

      client.on('message', function (msg) {
        helper.eq(msg, 'Hello over websockets');
        client.close();
        proxyServer.close();
        destiny.close();
        done();
      });
    });

    destiny.on('connection', function (socket) {
      socket.on('message', function (msg) {
        helper.eq(msg, payload);
        socket.send('Hello over websockets');
      });
    });
  });

  it('should forward continuation frames with big payload', function (done) {
    var payload = Array(65530).join('0');

    const proxyServer = http.createServer();
    proxyServer.listen(3000);
    // accept websocket proxy
    proxyServer.on('upgrade', (req, socket, head) => {
      httpProxy.ws(req, socket, head, { protocol : 'ws', hostname : '127.0.0.1', port : 1024 });
    });

    var destiny = new ws.Server({ port : 1024 }, function () {
      var client = new ws('ws://127.0.0.1:' + 3000);

      client.on('open', function () {
        client.send(payload);
      });

      client.on('message', function (msg) {
        helper.eq(msg, 'Hello over websockets');
        client.close();
        proxyServer.close();
        destiny.close();
        done();
      });
    });

    destiny.on('connection', function (socket) {
      socket.on('message', function (msg) {
        helper.eq(msg, payload);
        socket.send('Hello over websockets');
      });
    });
  });
});