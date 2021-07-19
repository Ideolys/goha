const helper  = require('../lib/helper.js');
const params  = require('../lib/params.js');

describe('helper', function () {

  describe('sanitize', function () {
    it('should sanitize input', () => {
      helper.eq(helper.sanitize('   CONNECTION   '), 'connection');
      helper.eq(helper.sanitize('keeP-alive '), 'keep-alive');
      helper.eq(helper.sanitize(), '');
      helper.eq(helper.sanitize(null), '');
      helper.eq(helper.sanitize(22), '');
    });
  });

  describe('uid', function () {
    it('should return a unique id', function (done) {
      var _uids   = [];
      var _nbUids = 1000;
      for (var i = 0; i < _nbUids; i++) {
        _uids.push(helper.uid());
      }
      for (var j = _nbUids - 1; j >= 0; j--) {
        var _uid   = _uids[j];
        var _found = false;

        for (var k = 0; k < j; k++) {
          if (_uid === _uids[k]) {
            _found = true;
            break;
          }
        }
        helper.eq(_found, false);
        _uids.splice(j, 1);
        if (!_uids.length) {
          done();
        }
      }
    });
  });

  describe('createHttpHeader', function () {
    it('should generate HTTP headers and insert the prefix and return a buffer', () => {
      let _headers = {
        'user-agent' : 'curl/7.22.0',
        host         : '127.0.0.1:8000',
        accept       : '*/*'
      };
      let _res = helper.createHttpHeader('prefix', _headers);
      helper.eq(Buffer.isBuffer(_res), true);
      helper.eq(_res.toString('utf8'), 'prefix\r\nuser-agent: curl/7.22.0\r\nhost: 127.0.0.1:8000\r\naccept: */*\r\n\r\n' );
    });
    it('should accept array in headers', () => {
      let _headers = {
        host    : '127.0.0.1:8000',
        cookies : ['bla', 'other']
      };
      let _res = helper.createHttpHeader('HTTP', _headers);
      helper.eq(_res.toString('utf8'), 'HTTP\r\nhost: 127.0.0.1:8000\r\ncookies: bla\r\ncookies: other\r\n\r\n' );
    });
    it('should never crash if headers is  are string is null or undefined', () => {
      helper.eq(helper.createHttpHeader('HTTP', {}).toString('utf8'), 'HTTP\r\n\r\n' );
      helper.eq(helper.createHttpHeader('HTTP', []).toString('utf8'), 'HTTP\r\n\r\n' );
      helper.eq(helper.createHttpHeader('HTTP', null).toString('utf8'), 'HTTP\r\n\r\n' );
      helper.eq(helper.createHttpHeader('HTTP', 2).toString('utf8'), 'HTTP\r\n\r\n' );
      helper.eq(helper.createHttpHeader('HTTP').toString('utf8'), 'HTTP\r\n\r\n' );
    });
  });

  describe('getRequestHeaders', function () {
    it('should copy headers (except host, why ????????????????) and set the correct x-forwarded-* headers', function () {
      let _request = {
        connection : {
          remoteAddress : '192.168.1.2',
          remotePort    : '8080'
        },
        headers : {
          host   : '192.168.1.2:8080',
          accept : '*/*'
        }
      };
      _request[params.UID] = '112asdazdaz';
      let _clone = helper.cloneHeaderForProxy(_request);
      helper.eq(_clone, {
        accept              : '*/*',
        'x-forwarded-for'   : '192.168.1.2',
        'x-forwarded-proto' : 'http',
        'x-forwarded-host'  : '192.168.1.2:8080',
        'x-request-id'      : '112asdazdaz'
      });
    });
    it('should overwrite existing x-forwarded and add a unique global id with x-request-id', function () {
      let _request = {
        connection : {
          remoteAddress : '192.168.1.2',
          remotePort    : '8080'
        },
        headers : {
          host                : '192.168.1.2:8080',
          'x-forwarded-for'   : '10.168.1.3',
          'x-forwarded-proto' : 'https',
          'x-forwarded-host'  : '10.168.1.3'
        }
      };
      _request[params.UID] = '3312asdazdaz';
      let _clone = helper.cloneHeaderForProxy(_request);
      helper.eq(_clone, {
        'x-forwarded-for'   : '192.168.1.2',
        'x-forwarded-proto' : 'http',
        'x-forwarded-host'  : '192.168.1.2:8080',
        'x-request-id'      : '3312asdazdaz'
      });
    });
  });
});
