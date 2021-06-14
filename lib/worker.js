// const cluster = require('cluster');
const http = require('http');
// const path = require('path');

// Workers can share any TCP connection
// In this case it is an HTTP server
const server = http.createServer((req, res) => {
  res.writeHead(200);
  res.end('hello world\n');
}).listen(8000);

console.log(`New Worker ${process.pid} started ${process.version}`);


process.on('message', (msg) => {
  // the master process ask us to shutdown gracefully
  if (msg === 'shutdown') {
    console.log('-- WORKER grace fully shutdown');
    // Initiate graceful close of any connections to server
  }
});
