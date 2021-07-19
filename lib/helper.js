const package = require('../package.json');
const assert = require('assert');
const params = require('./params');
const stdout = process.stdout.write.bind(process.stdout); // must use bind to avoid undefined "this": https://stackoverflow.com/questions/43362222/nodejs-short-alias-for-process-stdout-write

const UID_TIME_REFERENCE = (new Date(2021, 0, 1)).getTime();


/**
 * Print info about software
 *
 * @return {String}
 */
function printVersion () {
  let _text = [];
  _text.push('GoHA Reverse Proxy : v' + package.version);
  _text.push('- Publication date (UTC): ' + package.gohaPublicationDate);
  return _text.join('\n');
}

/**
 * get host without port
 * @param  {Object} req Nodejs
 * @return {String}     hostname
 */
function getHostWithoutPort (req) {
  return (typeof req.headers.host === 'string') ? req.headers.host.split(':')[0] : '';
}

/**
 * Create logger
 *
 * @param  {String}  namespace of logs
 * @return {Object}  { log, error function }
 */
function logger (namespace) {
  return {
    info : (msg) => {
      return stdout(`[${namespace}]\tINFO\t${process.pid}\t${msg}\n`);
    },
    error : (msg) => {
      return stdout(`[${namespace}]\tERROR\t${process.pid}\t${msg}\n`);
    },
    warn : (msg) => {
      return stdout(`[${namespace}]\tWARN\t${process.pid}\t${msg}\n`);
    }
  };
}


function getJSONData (req, callback) {
  let _body = '';
  let _res  = {};
  let _err  = null;
  if (req.headers['content-type'] !== 'application/json') {
    return callback(_err);
  }
  req.on('data', chunk => {
    _body += chunk;
  });
  req.on('end', () => {
    try {
      _res = JSON.parse(_body);
    }
    catch (e) {
      _err = e;
    }
    return callback(_err, _res);
  });
}

// function req (req, msg) {
//   return {
//     info : (msg) => {
//       return stdout(`[REQ]\tINFO\t${msg}\n${process.pid}\t${req[params.UID]}`);
//     },
//     error : (msg) => {
//       return stdout(`[REQ]\tERROR\t${msg}\n${process.pid}\t${req[params.UID]}`);
//     },
//     warn : (msg) => {
//       return stdout(`[REQ]\tWARN\t${msg}\n${process.pid}\t${req[params.UID]}`);
//     }
//   };
// }

function eq (actual, expected) {
  assert.strictEqual(JSON.stringify(actual, null, 2), JSON.stringify(expected, null, 2));
}

/**
 * Creates a http header and return a buffer
 *
 * TODO: This code should be faster tha node setHeader / writeHeader
 *
 * @param      {string}  prefix   The prefix to add before header
 * @param      {Object}  headers  The headers
 * @return     {Buffer}  Buffer ready to write in the socket
 */
function createHttpHeader (prefix, headers) {
  let _head = prefix;
  if (headers === null || headers === undefined) {
    headers = {};
  }
  for (const [key, value] of Object.entries(headers)) {
    if (!Array.isArray(value)) {
      _head += `\r\n${key}: ${value}`;
    }
    else {
      for (let i = 0; i < value.length; i++) {
        _head += `\r\n${key}: ${value[i]}`;
      }
    }
  }
  _head += '\r\n\r\n';
  return Buffer.from(_head, 'ascii');
}

/**
 * Clone header for proxy
 *
 * GoHA follows the commonly used "x-forwarded-for" header because it is more popular and simpler/faster to parse.
 * https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/X-Forwarded-For
 *
 * The standard is more complex for ipv6 (needs square braquets for ipv6, ...) and seems to be not very well adopted
 * https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Forwarded
 *
 * Moreover, GoHA replaces any existing headers x-forwarded to provide a trusted information to backend servers.
 *
 * @param   {Object}  req  The request
 * @return  {Onject}       The header cloned
 */
function cloneHeaderForProxy (req) {
  const headers = {};

  // clone the header of the request
  for (const [key, value] of Object.entries(req.headers)) {
    if (key.charAt(0) !== ':' && key !== 'host') { // TODO pourquoi ?
      headers[key] = value;
    }
  }
  // Normaly, we should concatenate with existing x-forwarded values. When multiple proxies are used.
  // The left-most IP address is the IP address of the originating client
  // https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/X-Forwarded-For
  //
  // BUT... It can become a security issue if the backend application relies on this for IP filtering.
  // We force the replacement of these values because GoHA is built to be a first-level front proxy.
  headers['x-forwarded-for'] = (req.connection.remoteAddress || req.socket.remoteAddress);
  headers['x-forwarded-proto'] = (req.connection.encrypted !== undefined /* || req.socket.encrypted !== undefined */ ) ? 'https' : 'http';
  // TODO trust and port ?
  headers['x-forwarded-host'] = ( /* req.headers[':authority'] || */ req.headers.host || ''); // TODO support authority for http2?
  // req.headers['x-forwarded-port']  = req.headers.host.match(/:(\d+)/) ? : '';

  if (req[params.UID] !== undefined) {
    headers['x-request-id'] = req[params.UID];
  }
  return headers;
}

/* function cloneHeaderForProxy (req) {
  const headers = {};
  for (const [ key, value ] of Object.entries(req.headers)) {
    if (key.charAt(0) !== ':' && key !== 'host') {
      headers[key] = value;
    }
  }

  function printIp (address) {
    return /:.*:/.test(address) ? `"[${address}]"` : address;
  }

  const forwarded = [
    `by=${printIp(req.socket.localAddress)}`,
    `for=${printIp(req.socket.remoteAddress)}`,
    `proto=${req.socket.encrypted ? 'https' : 'http'}`,
    `host=${printIp(req.headers[AUTHORITY] || req.headers[HOST] || '')}`
  ].join('; ');

  if (headers[FORWARDED]) {
    headers[FORWARDED] += `, ${forwarded}`;
  }
  else {
    headers[FORWARDED] = `${forwarded}`;
  }

  return setupHeaders(headers);
}*/

/**
 * Ultra fast globally unique 64 bits id.
 *
 * It is not a true random generator. Here the choice is performance first.
 *
 * 41 bits for timestamp in milliseconds from 2021-01-01. It works until 2090.
 * 23 bits for a random number
 *
 * @return {String} unique id. It is a String because Number supports 53 bits number)
 */
function uid () {
  const _now = Date.now() - UID_TIME_REFERENCE;

  // generate random number from 0 to 2^23
  const _random = Math.floor(Math.random() * ((1 << 23) - 1));

  // convert timestamp to big number
  const _guid = BigInt(_now) * (1n << 23n) + BigInt(_random);

  return _guid.toString();
}

/**
 * Sanitize input
 *
 * @param   {String}  name   the string to sanitize
 * @return  {String}         sanitized output
 */
function sanitize (name) {
  return typeof name === 'string' ? name.trim().toLowerCase() : '';
}

/**
 * Return HTTP response
 *
 * @param      {Object}         res     The resource
 * @param      {Integer}        status  HTTP status
 * @param      {String|Object}  data    The data
 */
function httpResponse (res, status, data) {
  if (typeof(data) === 'string') {
    res.writeHead(status, {'Content-Type' : 'text/plain'});
    return res.end(data);
  }
  res.writeHead(status, {'Content-Type' : 'application/json'});
  res.end(JSON.stringify(data));
}

module.exports = {
  printVersion,
  createHttpHeader,
  sanitize,
  cloneHeaderForProxy,
  getJSONData,
  httpResponse,
  logger,
  getHostWithoutPort,
  eq,
  uid
};