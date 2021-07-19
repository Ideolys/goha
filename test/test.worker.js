var worker    = require('../lib/worker.js');
var should    = require('should');
const loadBalancing = require('../middleware/loadBalancing.js');
const nock    = require('nock');
const http    = require('http');
const assert  = require('assert');
const request = require('request');
const evilDns = require('evil-dns');

const masterConfig = {
  targetsPerDomain      : {},
  certificatesPerDomain : {},
  defaultCertificates   : {
    privkey : '',
    cert    : ''
  },
  currentConfig : {
    port    : 3001,
    portSSL : 3002
  }
};

function resetConfig () {
  Object.assign(worker, JSON.parse(JSON.stringify(masterConfig)));
  return worker;
}

describe('worker proxy', function () {

  afterEach((done) => {
    worker.stopListening();
    evilDns.clear();
    nock.cleanAll();
    done();
  });

  it('should return 404 error if the proxy does not know the domain', (done) => {
    resetConfig();
    worker.startListening();
    nock('http://127.0.0.1:3003').get('/').reply(200, { yes : true });
    // request from outside
    request.get('http://127.0.0.1:3001', function (err, res, body) {
      assert.equal(res.statusCode, 404);
      assert.equal(body, 'Page not found');
      done();
    });
  });

  it('should redirect to the right destination', (done) => {
    // fake DNS
    evilDns.add('goha-domain.net', '127.0.0.1');
    // copy and set goha config
    resetConfig().targetsPerDomain = {
      'goha-domain.net' : { backends : [{url : 'http://127.0.0.1:3003'}] }
    };
    // Mock destination URL
    nock('http://127.0.0.1:3003').get('/').reply(200, 'ok3003');
    // Start proxy
    worker.startListening();
    // Simulate incoming requests
    request.get('http://goha-domain.net:3001', function (err, res, body) {
      assert.equal(res.statusCode, 200);
      assert.equal(body, 'ok3003');
      done();
    });
  });

  it('should redirect to the right destinations, and overwrite header', (done) => {
    // fake DNS
    evilDns.add('goha-domain.net', '127.0.0.1');
    evilDns.add('goha-matrix.net', '127.0.0.1');
    evilDns.add('goha-other.com' , '127.0.0.1');
    // copy and set goha config
    resetConfig().targetsPerDomain = {
      'goha-domain.net' : { backends : [{url : 'http://127.0.0.1:3003'                                            }]},
      'goha-matrix.net' : { backends : [{url : 'http://redirect-blabla.fr'     , headers : {'x-schema' : '5000' } }]},
      'goha-other.com'  : { backends : [{url : 'http://redirect-otherblabla.fr'                                   }]}
    };
    // Mock destination URL
    nock('http://127.0.0.1:3003'         ).get('/'        ).reply(200, 'ok3003'           );
    nock('http://redirect-otherblabla.fr').get('/file.pdf').reply(200, 'goha-otherblabla' );
    nock('http://redirect-blabla.fr'     ).get('/test'    ).reply(function (uri, body, cb) {
      // should add header
      assert.equal(this.req.headers['x-schema'], '5000');
      cb(null, [200, 'goha-blabla']);
    });
    // Start proxy
    worker.startListening();
    // Simulate incoming requests
    request.get('http://goha-domain.net:3001', function (err, res, body) {
      assert.equal(res.statusCode, 200);
      assert.equal(body, 'ok3003');
      request.get('http://goha-matrix.net:3001/test', function (err, res, body) {
        assert.equal(res.statusCode, 200);
        assert.equal(body, 'goha-blabla');
        request.get('http://goha-other.com:3001/file.pdf', function (err, res, body) {
          assert.equal(res.statusCode, 200);
          assert.equal(body, 'goha-otherblabla');
          done();
        });
      });
    });
  });

  it('should redirect to the right destination according to header version', (done) => {
    let _iteration = 0;
    let _nbRequests = 12;
    let _nbAnswerTotal = 0;
    // fake DNS
    evilDns.add('goha-domain.net', '127.0.0.1');
    // copy and set goha config
    resetConfig().targetsPerDomain = {
      'goha-domain.net' : {
        backends : [
          { url : 'http://127.0.0.1:3005' , nbConnection : 0, isReady : true, version : '2' },
          { url : 'http://127.0.0.1:3006' , nbConnection : 0, isReady : true, version : '0' },
          { url : 'http://127.0.0.1:3007' , nbConnection : 0, isReady : true, version : '0' }
        ],
        loadBalancingFn : loadBalancingFn.toString(),
        versioning      : {
          header  : 'app-version', // case-insensitive version header name
          default : '0',                // default version if client has no version header
        }
      }
    };
    let _nbAnswersPerVersion = { v0 : 0, v2 : 0, v0bis : 0 };
    // Mock destination URL
    nock('http://127.0.0.1:3005').persist().get(/\d+/).delay(100).reply(function (uri, body, cb) {
      assert.equal(this.req.headers['app-version'], '2');
      _nbAnswersPerVersion.v2++;
      cb(null, [200, '2']);
    });
    nock('http://127.0.0.1:3006').persist().get(/\d+/).delay(100).reply(function (uri, body, cb) {
      assert.equal(this.req.headers['app-version'], undefined);
      _nbAnswersPerVersion.v0++;
      cb(null, [200, '0']);
    });
    nock('http://127.0.0.1:3007').persist().get(/\d+/).delay(100).reply(function (uri, body, cb) {
      assert.equal(this.req.headers['app-version'], undefined);
      _nbAnswersPerVersion.v0bis++;
      cb(null, [200, '0']);
    });
    // Start proxy
    worker.startListening();

    // Simulate incoming requests
    callFunctionInterval(_nbRequests, 0, () => {
      _iteration++;
      request.get('http://goha-domain.net:3001/'+_iteration, function (err) {
        assert.equal(err+'', 'null');
        _nbAnswerTotal++;
        if (_nbAnswerTotal >= _nbRequests) {
          assert.equal(_nbAnswersPerVersion.v0, 6);
          assert.equal(_nbAnswersPerVersion.v0bis, 6);
          assert.equal(_nbAnswersPerVersion.v2, 0);
          nextTest();
        }
      });
    });

    function nextTest () {
      _nbAnswerTotal = 0;
      const options = {
        url     : 'http://goha-domain.net:3001/1',
        headers : {
          'app-version' : '2'
        }
      };
      callFunctionInterval(_nbRequests, 0, () => {
        request.get(options, function (err) {
          assert.equal(err+'', 'null');
          _nbAnswerTotal++;
          if (_nbAnswerTotal >= _nbRequests) {
            assert.equal(_nbAnswersPerVersion.v0, 6);
            assert.equal(_nbAnswersPerVersion.v0bis, 6);
            assert.equal(_nbAnswersPerVersion.v2, 12);
            done();
          }
        });
      });
    }
  });

  it('should redirect to the right destination even if version starts with the same name', (done) => {
    let _iteration = 0;
    let _nbRequests = 12;
    let _nbAnswerTotal = 0;
    // fake DNS
    evilDns.add('goha-domain.net', '127.0.0.1');
    // copy and set goha config
    resetConfig().targetsPerDomain = {
      'goha-domain.net' : {
        backends : [
          { url : 'http://127.0.0.1:3005' , nbConnection : 0, isReady : true, version : '2' },
          { url : 'http://127.0.0.1:3006' , nbConnection : 0, isReady : true, version : '2-alpha' },
          { url : 'http://127.0.0.1:3007' , nbConnection : 0, isReady : true, version : '2' }
        ],
        loadBalancingFn : loadBalancingFn.toString(),
        versioning      : {
          header  : 'app-version', // case-insensitive version header name
          default : '2',                // default version if client has no version header
        }
      }
    };
    let _nbAnswersPerVersion = { v2 : 0, v2bis : 0, v2alpha : 0 };
    // Mock destination URL
    nock('http://127.0.0.1:3005').persist().get(/\d+/).delay(100).reply(function (uri, body, cb) {
      assert.equal(this.req.headers['app-version'], '2');
      _nbAnswersPerVersion.v2++;
      cb(null, [200, '2']);
    });
    nock('http://127.0.0.1:3006').persist().get(/\d+/).delay(100).reply(function (uri, body, cb) {
      assert.equal(this.req.headers['app-version'], '2-alpha');
      _nbAnswersPerVersion.v2alpha++;
      cb(null, [200, '2-alpha']);
    });
    nock('http://127.0.0.1:3007').persist().get(/\d+/).delay(100).reply(function (uri, body, cb) {
      assert.equal(this.req.headers['app-version'], '2');
      _nbAnswersPerVersion.v2bis++;
      cb(null, [200, '2']);
    });
    // Start proxy
    worker.startListening();

    // Simulate incoming requests
    const options = {
      url     : 'http://goha-domain.net:3001/1',
      headers : {
        'app-version' : '2-alpha'
      }
    };
    callFunctionInterval(_nbRequests, 0, () => {
      _iteration++;
      request.get(options, function (err) {
        assert.equal(err+'', 'null');
        _nbAnswerTotal++;
        if (_nbAnswerTotal >= _nbRequests) {
          assert.equal(_nbAnswersPerVersion.v2, 0);
          assert.equal(_nbAnswersPerVersion.v2bis, 0);
          assert.equal(_nbAnswersPerVersion.v2alpha, 12);
          nextTest();
        }
      });
    });

    function nextTest () {
      _nbAnswerTotal = 0;
      const options = {
        url     : 'http://goha-domain.net:3001/1',
        headers : {
          'app-version' : '2'
        }
      };
      callFunctionInterval(_nbRequests, 0, () => {
        request.get(options, function (err) {
          assert.equal(err+'', 'null');
          _nbAnswerTotal++;
          if (_nbAnswerTotal >= _nbRequests) {
            assert.equal(_nbAnswersPerVersion.v2, 6);
            assert.equal(_nbAnswersPerVersion.v2bis, 6);
            assert.equal(_nbAnswersPerVersion.v2alpha, 12);
            done();
          }
        });
      });
    }
  });
  it('should load balance among multiple URLs. Each backend should receive the same number of requests', (done) => {
    let _iteration = 0;
    let _nbRequests = 12;
    let _nbAnswerTotal = 0;
    let _nbAnswers = {
      ok3003 : 0,
      ok3004 : 0,
      ok3005 : 0
    };
    // fake DNS
    evilDns.add('goha-domain.net', '127.0.0.1');
    // copy and set goha config
    resetConfig().targetsPerDomain = {
      'goha-domain.net' : {
        backends : [
          { url : 'http://127.0.0.1:3003' , nbConnection : 0, isReady : true},
          { url : 'http://127.0.0.1:3004' , nbConnection : 0, isReady : true},
          { url : 'http://127.0.0.1:3005' , nbConnection : 0, isReady : true}
        ],
        loadBalancingFn : loadBalancingFn.toString()
      }
    };
    // Mock destination URL
    nock('http://127.0.0.1:3003').persist().get(/\d+/).delay(100).reply(200, 'ok3003'); // overloaded backend
    nock('http://127.0.0.1:3004').persist().get(/\d+/).delay(100).reply(200, 'ok3004');
    nock('http://127.0.0.1:3005').persist().get(/\d+/).delay(100).reply(200, 'ok3005');
    // Start proxy
    worker.startListening();

    // Simulate incoming requests
    callFunctionInterval(_nbRequests, 0, () => {
      _iteration++;
      request.get('http://goha-domain.net:3001/'+_iteration, function (err, res, body) {
        assert.equal(err+'', 'null');
        _nbAnswerTotal++;
        _nbAnswers[body]++;
        if (_nbAnswerTotal >= _nbRequests) {
          assert.equal(_nbAnswers.ok3003, 4);
          assert.equal(_nbAnswers.ok3004, 4);
          assert.equal(_nbAnswers.ok3005, 4);
          done();
        }
      });
    });
  });

  it('should not crash if loadBalancingFn is an arrow function', (done) => {
    let _iteration = 0;
    let _nbRequests = 12;
    let _nbAnswerTotal = 0;
    let _nbAnswers = {
      ok3003 : 0,
      ok3004 : 0,
      ok3005 : 0
    };
    // fake DNS
    evilDns.add('goha-domain.net', '127.0.0.1');
    // copy and set goha config
    resetConfig().targetsPerDomain = {
      'goha-domain.net' : {
        backends : [
          { url : 'http://127.0.0.1:3003' , nbConnection : 0, isReady : true},
          { url : 'http://127.0.0.1:3004' , nbConnection : 0, isReady : true},
          { url : 'http://127.0.0.1:3005' , nbConnection : 0, isReady : true}
        ],
        loadBalancingFn : ((req, backend) => {
          return backend.nbConnection;
        }).toString()
      }
    };
    // Mock destination URL
    nock('http://127.0.0.1:3003').persist().get(/\d+/).delay(100).reply(200, 'ok3003'); // overloaded backend
    nock('http://127.0.0.1:3004').persist().get(/\d+/).delay(100).reply(200, 'ok3004');
    nock('http://127.0.0.1:3005').persist().get(/\d+/).delay(100).reply(200, 'ok3005');
    // Start proxy
    worker.startListening();

    // Simulate incoming requests
    callFunctionInterval(_nbRequests, 0, () => {
      _iteration++;
      request.get('http://goha-domain.net:3001/'+_iteration, function (err, res, body) {
        assert.equal(err+'', 'null');
        _nbAnswerTotal++;
        _nbAnswers[body]++;
        if (_nbAnswerTotal >= _nbRequests) {
          assert.equal(_nbAnswers.ok3003, 4);
          assert.equal(_nbAnswers.ok3004, 4);
          assert.equal(_nbAnswers.ok3005, 4);
          done();
        }
      });
    });
  });

  it('should load balance among multiple URLs and redirect to the backend which have the lowest number of opened connections', (done) => {
    let _iteration = 0;
    let _nbRequests = 10;
    let _nbAnswerTotal = 0;
    let _nbAnswers = {
      ok3003 : 0,
      ok3004 : 0
    };
    // fake DNS
    evilDns.add('goha-domain.net', '127.0.0.1');
    // copy and set goha config
    resetConfig().targetsPerDomain = {
      'goha-domain.net' : {
        backends : [
          { url : 'http://127.0.0.1:3003' , nbConnection : 0, isReady : true},
          { url : 'http://127.0.0.1:3004' , nbConnection : 0, isReady : true}
        ],
        loadBalancingFn : loadBalancingFn.toString()
      }
    };
    // Mock destination URL
    nock('http://127.0.0.1:3003').persist().get(/\d+/).delay(1000).reply(200, 'ok3003'); // overloaded backend
    nock('http://127.0.0.1:3004').persist().get(/\d+/).reply(200, 'ok3004');
    // Start proxy
    worker.startListening();

    // Simulate incoming requests
    callFunctionInterval(_nbRequests, 50, () => {
      _iteration++;
      request.get('http://goha-domain.net:3001/'+_iteration, function (err, res, body) {
        assert.equal(err+'', 'null');
        _nbAnswerTotal++;
        _nbAnswers[body]++;
        if (_nbAnswerTotal >= _nbRequests) {
          assert.equal(_nbAnswers.ok3003, 1);
          assert.equal(_nbAnswers.ok3004, 9);
          done();
        }
      });
    });
  });

  it('should not sent request to a backend if it is not in a ready state', (done) => {
    let _iteration = 0;
    let _nbRequests = 12;
    let _nbAnswerTotal = 0;
    let _nbAnswers = {
      ok3003 : 0,
      ok3004 : 0,
      ok3005 : 0
    };
    // fake DNS
    evilDns.add('goha-domain.net', '127.0.0.1');
    // copy and set goha config
    resetConfig().targetsPerDomain = {
      'goha-domain.net' : {
        backends : [
          { url : 'http://127.0.0.1:3003' , nbConnection : 0, isReady : true},
          { url : 'http://127.0.0.1:3004' , nbConnection : 0, isReady : false},
          { url : 'http://127.0.0.1:3005' , nbConnection : 0, isReady : true}
        ],
        loadBalancingFn : loadBalancingFn.toString()
      }
    };
    // Mock destination URL
    nock('http://127.0.0.1:3003').persist().get(/\d+/).delay(100).reply(200, 'ok3003'); // overloaded backend
    nock('http://127.0.0.1:3004').persist().get(/\d+/).delay(100).reply(200, 'ok3004');
    nock('http://127.0.0.1:3005').persist().get(/\d+/).delay(100).reply(200, 'ok3005');
    // Start proxy
    worker.startListening();

    // Simulate incoming requests
    callFunctionInterval(_nbRequests, 0, () => {
      _iteration++;
      request.get('http://goha-domain.net:3001/'+_iteration, function (err, res, body) {
        assert.equal(err+'', 'null');
        _nbAnswerTotal++;
        _nbAnswers[body]++;
        if (_nbAnswerTotal >= _nbRequests) {
          assert.equal(_nbAnswers.ok3003, 6);
          assert.equal(_nbAnswers.ok3004, 0);
          assert.equal(_nbAnswers.ok3005, 6);
          done();
        }
      });
    });
  });

  it('should allow to use a custom middleware to select backends', (done) => {
    let _iteration = 0;
    let _nbRequests = 12;
    let _nbAnswerTotal = 0;
    let _nbAnswers = {
      backend1 : 0,
      backend2 : 0,
      backend3 : 0
    };
    // fake DNS
    evilDns.add('goha-domain.net', '127.0.0.1');
    // copy and set goha config
    resetConfig().targetsPerDomain = {
      'goha-domain.net' : {
        backends : [
          { url : 'http://127.0.0.1:4000' , nbConnection : 0, isReady : true},
          { url : 'http://127.0.0.2:4000' , nbConnection : 0, isReady : true},
          { url : 'http://127.0.0.3:4000' , nbConnection : 0, isReady : true}
        ],
        loadBalancingFn : loadBalancing.selectBackendUsingBase64IP(/^\/render\/(.*)/).toString()
      }
    };
    // Mock destination URL
    nock('http://127.0.0.1:4000').persist().get(/\d+/).delay(100).reply(200, 'backend1'); // overloaded backend
    nock('http://127.0.0.2:4000').persist().get(/\d+/).delay(100).reply(200, 'backend2');
    nock('http://127.0.0.3:4000').persist().get(/\d+/).delay(100).reply(200, 'backend3');
    // Start proxy
    worker.startListening();

    var _ipBase64 = Buffer.from('127.0.0.2'.padEnd(15, ' ')).toString('base64');
    // Simulate incoming requests
    callFunctionInterval(_nbRequests, 0, () => {
      _iteration++;
      request.get('http://goha-domain.net:3001/render/'+_ipBase64+_iteration, function (err, res, body) {
        assert.equal(err+'', 'null');
        _nbAnswerTotal++;
        _nbAnswers[body]++;
        if (_nbAnswerTotal >= _nbRequests) {
          assert.equal(_nbAnswers.backend2, 12);
          _nbAnswerTotal = 0;
          // for other queries, it should load balance using number of connections to backends
          callFunctionInterval(_nbRequests, 0, () => {
            request.get('http://goha-domain.net:3001/other/1', function (err, res, body) {
              assert.equal(err+'', 'null');
              _nbAnswerTotal++;
              _nbAnswers[body]++;
              if (_nbAnswerTotal >= _nbRequests) {
                assert.equal(_nbAnswers.backend1, 4);
                assert.equal(_nbAnswers.backend2, 16);
                assert.equal(_nbAnswers.backend3, 4);
                done();
              }
            });
          });
        }
      });
    });
  });

  it('should force redirect to a backend if loadBalancingFn returns Number.MIN_SAFE_INTEGER', (done) => {
    let _iteration = 0;
    let _nbRequests = 12;
    let _nbAnswerTotal = 0;
    let _nbAnswers = {
      backend1 : 0,
      backend2 : 0,
      backend3 : 0
    };
    // fake DNS
    evilDns.add('goha-domain.net', '127.0.0.1');
    // copy and set goha config
    resetConfig().targetsPerDomain = {
      'goha-domain.net' : {
        backends : [
          { url : 'http://127.0.0.1:4000' , nbConnection : 0, version : '1', isReady : true},
          { url : 'http://127.0.0.2:4000' , nbConnection : 0, version : '2', isReady : true},
          { url : 'http://127.0.0.3:4000' , nbConnection : 0, version : '1', isReady : true}
        ],
        loadBalancingFn : loadBalancing.selectBackendUsingBase64IP(/^\/render\/(.*)/).toString(),
        versioning      : {
          header  : 'app-version', // case-insensitive version header name
          default : '1',           // default version if client has no version header
        }
      }
    };
    // Mock destination URL
    nock('http://127.0.0.1:4000').persist().get(/\d+/).delay(100).reply(200, 'backend1'); // overloaded backend
    nock('http://127.0.0.2:4000').persist().get(/\d+/).delay(100).reply(200, 'backend2');
    nock('http://127.0.0.3:4000').persist().get(/\d+/).delay(100).reply(200, 'backend3');
    // Start proxy
    worker.startListening();

    var _ipBase64 = Buffer.from('127.0.0.2'.padEnd(15, ' ')).toString('base64');
    // Simulate incoming requests
    callFunctionInterval(_nbRequests, 0, () => {
      _iteration++;
      request.get('http://goha-domain.net:3001/render/'+_ipBase64+_iteration, function (err, res, body) {
        assert.equal(err+'', 'null');
        _nbAnswerTotal++;
        _nbAnswers[body]++;
        if (_nbAnswerTotal >= _nbRequests) {
          assert.equal(_nbAnswers.backend2, 12);
          _nbAnswerTotal = 0;
          // for other queries, it should load balance using number of connections to backends
          callFunctionInterval(_nbRequests, 0, () => {
            request.get('http://goha-domain.net:3001/other/1', function (err, res, body) {
              assert.equal(err+'', 'null');
              _nbAnswerTotal++;
              _nbAnswers[body]++;
              if (_nbAnswerTotal >= _nbRequests) {
                assert.equal(_nbAnswers.backend1, 6);
                assert.equal(_nbAnswers.backend2, 12);
                assert.equal(_nbAnswers.backend3, 6);
                done();
              }
            });
          });
        }
      });
    });
  });

  it('should retry another backend if the first one is dead (not reachable)', (done) => {
    let _iteration = 0;
    let _nbRequests = 12;
    let _nbAnswerTotal = 0;
    let _nbAnswers = {
      backend1 : 0,
      backend2 : 0,
      backend3 : 0
    };
    // fake DNS
    evilDns.add('goha-domain.net', '127.0.0.1');
    // copy and set goha config
    resetConfig().targetsPerDomain = {
      'goha-domain.net' : {
        backends : [
          { url : 'http://127.0.0.1:4000' , nbConnection : 0, isReady : true},
          { url : 'http://127.0.0.2:4000' , nbConnection : 0, isReady : true},
          { url : 'http://127.0.0.3:4000' , nbConnection : 0, isReady : true}
        ],
        loadBalancingFn : loadBalancing.selectBackendUsingBase64IP(/^\/render\/(.*)/).toString()
      }
    };
    // Mock destination URL
    // dead server nock('http://127.0.0.1:4000').persist().get(/\d+/).delay(100).reply(200, 'backend1'); // overloaded backend
    nock('http://127.0.0.2:4000').persist().get(/\d+/).delay(100).reply(200, 'backend2');
    nock('http://127.0.0.3:4000').persist().get(/\d+/).delay(100).reply(200, 'backend3');
    // Start proxy
    worker.startListening();

    // Simulate incoming requests
    callFunctionInterval(_nbRequests, 0, () => {
      _iteration++;
      request.get('http://goha-domain.net:3001/'+_iteration, function (err, res, body) {
        assert.equal(err+'', 'null');
        _nbAnswerTotal++;
        _nbAnswers[body]++;
        if (_nbAnswerTotal >= _nbRequests) {
          assert.equal(_nbAnswers.backend1, 0);
          assert.equal(_nbAnswers.backend2, 6);
          assert.equal(_nbAnswers.backend3, 6);
          done();
        }
      });
    });
  });

  it('should retry another backend if ETIMEDOUT, ESOCKETTIMEDOUT, ECONNREFUSED, EPIPE, ENOTFOUND, ECONNRESET', (done) => {
    let _iteration = 0;
    let _nbRequests = 12;
    let _nbAnswerTotal = 0;
    let _nbAnswers = {
      backend1 : 0,
      backend2 : 0,
      backend3 : 0
    };
    // fake DNS
    evilDns.add('goha-domain.net', '127.0.0.1');
    // copy and set goha config
    resetConfig().targetsPerDomain = {
      'goha-domain.net' : {
        backends : [
          { url : 'http://127.0.0.1:4000' , nbConnection : 0, isReady : true},
          { url : 'http://127.0.0.2:4000' , nbConnection : 0, isReady : true},
          { url : 'http://127.0.0.3:4000' , nbConnection : 0, isReady : true}
        ],
        loadBalancingFn : loadBalancing.selectBackendUsingBase64IP(/^\/render\/(.*)/).toString()
      }
    };
    // Mock destination URL
    nock('http://127.0.0.1:4000').get(/\d+/).delay(0).replyWithError({code : 'ETIMEDOUT'});
    nock('http://127.0.0.1:4000').get(/\d+/).delay(0).replyWithError({code : 'ESOCKETTIMEDOUT'});
    nock('http://127.0.0.1:4000').get(/\d+/).delay(0).replyWithError({code : 'ECONNREFUSED'});
    nock('http://127.0.0.1:4000').get(/\d+/).delay(0).replyWithError({code : 'EPIPE'});
    nock('http://127.0.0.1:4000').get(/\d+/).delay(0).replyWithError({code : 'ENOTFOUND'});
    nock('http://127.0.0.1:4000').persist().get(/\d+/).delay(0).replyWithError({code : 'ECONNRESET'});

    nock('http://127.0.0.2:4000').persist().get(/\d+/).delay(100).reply(200, 'backend2');
    nock('http://127.0.0.3:4000').persist().get(/\d+/).delay(100).reply(200, 'backend3');
    // Start proxy
    worker.startListening();

    // Simulate incoming requests
    callFunctionInterval(_nbRequests, 10, () => {
      _iteration++;
      request.get('http://goha-domain.net:3001/'+_iteration,function (err, res, body) {
        assert.equal(err+'', 'null');
        _nbAnswerTotal++;
        _nbAnswers[body]++;
        if (_nbAnswerTotal >= _nbRequests) {
          assert.equal(_nbAnswers.backend1, 0);
          assert.equal(_nbAnswers.backend2, 6);
          assert.equal(_nbAnswers.backend3, 6);
          done();
        }
      });
    });
  });

  it('should delay the retry if the backend is the same on error ETIMEDOUT, ESOCKETTIMEDOUT, ECONNREFUSED, EPIPE, ENOTFOUND, ECONNRESET', (done) => {
    let _iteration = 0;
    let _nbRequests = 1;
    // fake DNS
    evilDns.add('goha-domain.net', '127.0.0.1');
    // copy and set goha config
    resetConfig().targetsPerDomain = {
      'goha-domain.net' : {
        backends        : [ { url : 'http://127.0.0.1:4000' , nbConnection : 0, isReady : true}],
        loadBalancingFn : loadBalancing.selectBackendUsingBase64IP(/^\/render\/(.*)/).toString()
      }
    };
    var _elapsedTime = 0;
    var _interval = setInterval(() => {
      _elapsedTime++;
    }, 1000);
    nock('http://127.0.0.1:4000').get(/\d+/).delay(0).replyWithError({code : 'ECONNREFUSED'});
    nock('http://127.0.0.1:4000').get(/\d+/).delay(0).reply(200, function (uri, body, cb) {
      assert.equal(_elapsedTime > 8, true);
      cb(null, [200, 'backend1']);
    });
    // Start proxy
    worker.startListening();

    // Simulate incoming requests
    callFunctionInterval(_nbRequests, 10, () => {
      _iteration++;
      request.get('http://goha-domain.net:3001/'+_iteration,function (err, res, body) {
        assert.equal(err+'', 'null');
        assert.equal(body, 'backend1');
        clearInterval(_interval);
        done();
      });
    });
  });

  it.skip('should not count negative connections if config is reloaded');

});


/**
 * Call a function nb times, with an interval of xx milliseconds
 *
 * @param  {Number}   nb       number of function call
 * @param  {Number}   interval interval in ms between each call
 * @param  {Function} fn       function to call
 */
function callFunctionInterval (nb, interval, fn) {
  let _nbCall = 0;
  let _intervalRef = setInterval(() => {
    _nbCall++;
    if (_nbCall >= nb) {
      clearInterval(_intervalRef);
    }
    fn();
  }, interval);

}

function loadBalancingFn (req, backend) {
  return backend.nbConnection;
}

/* var _req = {
  url : 'client-1.test.net/test/file.pdf',
  connection : {},
  headers : {
    host : 'client-1.test.net'
  }
};*/