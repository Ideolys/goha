var config = require('../lib/config.js');
var helper = require('../lib/helper.js');
var should = require('should');

describe('config', function () {

  describe('mergeConfig', function () {
    describe('MERGE MODE (modify or add only, never delete)', function () {
      it('should return null if the configuration has not changed', function () {
        const _currentConfig = {
          domains : {
            'client-1.myapp.net'     : 'http://149.202.180.203:8102',
            'client-2.sub.myapp.net' : 'http://149.202.180.203:8103'
          }
        };
        const _newConfig = {
          domains : {}
        };
        helper.eq(config.merge(_currentConfig, _newConfig),  null);
        helper.eq(config.merge(_currentConfig, {}),  null);
        helper.eq(config.merge(_currentConfig, null),  null);
        helper.eq(config.merge(_currentConfig),  null);
        const _newConfigSame = {
          domains : {
            'client-1.myapp.net'     : 'http://149.202.180.203:8102',
            'client-2.sub.myapp.net' : 'http://149.202.180.203:8103'
          }
        };
        helper.eq(config.merge(_currentConfig, _newConfigSame),  null);
      });
      it('should add one domain', function () {
        const _currentConfig = {
          domains : {
            'client-1.myapp.net'     : 'http://149.202.180.203:8102',
            'client-2.sub.myapp.net' : 'http://149.202.180.203:8103'
          }
        };
        const _newConfig = {
          domains : {
            'new-1.myapp.net' : 'http://149.202.180.203:8106'
          }
        };
        helper.eq(config.merge(_currentConfig, _newConfig),  {
          domains : {
            'client-1.myapp.net'     : 'http://149.202.180.203:8102',
            'client-2.sub.myapp.net' : 'http://149.202.180.203:8103',
            'new-1.myapp.net'        : 'http://149.202.180.203:8106'
          }
        });
      });
      it('should add one domain and modify one. It should not modify current config', function () {
        const _currentConfig = {
          domains : {
            'client-1.myapp.net'     : 'http://149.202.180.203:8102',
            'client-2.sub.myapp.net' : 'http://149.202.180.203:8103'
          }
        };
        const _newConfig = {
          domains : {
            'new-1.myapp.net'    : 'http://149.202.180.203:8106',
            'client-1.myapp.net' : 'http://149.111.10.10:8100'
          }
        };
        helper.eq(config.merge(_currentConfig, _newConfig),  {
          domains : {
            'client-1.myapp.net'     : 'http://149.111.10.10:8100',
            'client-2.sub.myapp.net' : 'http://149.202.180.203:8103',
            'new-1.myapp.net'        : 'http://149.202.180.203:8106'
          }
        });
        // should not modify _currentConfig
        helper.eq(_currentConfig, JSON.parse(JSON.stringify(_currentConfig)));
      });
      it('should modify one domain. It should not modify current config. It should add backend if it does not exist', function () {
        const _currentConfig = {
          domains : {
            'client-1.myapp.net'     : { backends : [{url : 'http://149.202.180.203:8000'}], headers : {'x-schema' : '5000'} },
            'client-2.sub.myapp.net' : 'http://149.202.180.203:8103'
          }
        };
        const _newConfig = {
          domains : {
            'client-1.myapp.net' : { backends : [{url : 'http://149.202.180.203:9999'}], headers : {'x-schema' : '66'} },
          }
        };
        helper.eq(config.merge(_currentConfig, _newConfig),  {
          domains : {
            'client-1.myapp.net'     : { backends : [{url : 'http://149.202.180.203:8000'}, {url : 'http://149.202.180.203:9999'}], headers : {'x-schema' : '66'} },
            'client-2.sub.myapp.net' : 'http://149.202.180.203:8103'
          }
        });
        helper.eq(_currentConfig, JSON.parse(JSON.stringify(_currentConfig)));
      });
      it('should add one domain', function () {
        const _currentConfig = {
          domains : {
            'client-1.myapp.net'     : { backends : [{url : 'http://149.202.180.203:8000'}], headers : {'x-schema' : '5000'} },
            'client-2.sub.myapp.net' : 'http://149.202.180.203:8103'
          }
        };
        const _newConfig = {
          domains : {
            'client-3.myapp.net' : { backends : [{url : 'http://10.10.10.11:9999'}] },
          }
        };
        helper.eq(config.merge(_currentConfig, _newConfig),  {
          domains : {
            'client-1.myapp.net'     : { backends : [{url : 'http://149.202.180.203:8000'}], headers : {'x-schema' : '5000'} },
            'client-2.sub.myapp.net' : 'http://149.202.180.203:8103',
            'client-3.myapp.net'     : { backends : [{url : 'http://10.10.10.11:9999'}] }
          }
        });
        helper.eq(_currentConfig, JSON.parse(JSON.stringify(_currentConfig)));
      });
      it('should not change backend order', function () {
        const _currentConfig = {
          domains : {
            'client-1.myapp.net'     : { backends : [{url : 'http://10.10.10.10:8000'}, {url : 'http://11.10.10.11:8000'}, {url : 'http://21.10.10.11:8000'}], headers : {'x-schema' : '5000'} },
            'client-2.sub.myapp.net' : 'http://149.202.180.203:8103'
          }
        };
        const _newConfig = {
          domains : {
            'client-1.myapp.net' : { backends : [{url : 'http://11.10.10.11:8000'}, {url : 'http://10.10.10.10:8000'}], headers : {'x-schema' : '66'} },
          }
        };
        helper.eq(config.merge(_currentConfig, _newConfig),  {
          domains : {
            'client-1.myapp.net'     : { backends : [{url : 'http://10.10.10.10:8000'}, {url : 'http://11.10.10.11:8000'}, {url : 'http://21.10.10.11:8000'}], headers : {'x-schema' : '66'} },
            'client-2.sub.myapp.net' : 'http://149.202.180.203:8103'
          }
        });
        helper.eq(_currentConfig, JSON.parse(JSON.stringify(_currentConfig)));
      });
      it('should not change order of backends (second case) and it should not accept duplicated backend', function () {
        const _currentConfig = {
          domains : {
            'client-1.myapp.net'     : { backends : [{url : 'http://21.10.10.11:8000'}, {url : 'http://10.10.10.10:8000'}, {url : 'http://11.10.10.11:8000'}], headers : {'x-schema' : '5000'} },
            'client-2.sub.myapp.net' : 'http://149.202.180.203:8103'
          }
        };
        const _newConfig = {
          domains : {
            'client-1.myapp.net' : { backends : [{url : 'http://11.10.10.11:8000'}, {url : 'http://10.10.10.10:8000'}, {url : 'http://10.10.10.10:8000'}], headers : {'x-schema' : '66'} },
          }
        };
        helper.eq(config.merge(_currentConfig, _newConfig),  {
          domains : {
            'client-1.myapp.net'     : { backends : [{url : 'http://21.10.10.11:8000'}, {url : 'http://10.10.10.10:8000'}, {url : 'http://11.10.10.11:8000'}], headers : {'x-schema' : '66'} },
            'client-2.sub.myapp.net' : 'http://149.202.180.203:8103'
          }
        });
        helper.eq(_currentConfig, JSON.parse(JSON.stringify(_currentConfig)));
      });
      it('should set isReady : false for one backend', function () {
        const _currentConfig = {
          domains : {
            'client-1.myapp.net'     : { backends : [{url : 'http://21.10.10.11:8000'}, {url : 'http://10.10.10.10:8000'}, {url : 'http://11.10.10.11:8000'}], headers : {'x-schema' : '5000'} },
            'client-2.sub.myapp.net' : 'http://149.202.180.203:8103'
          }
        };
        const _newConfig = {
          domains : {
            'client-1.myapp.net' : { backends : [{url : 'http://10.10.10.10:8000', isReady : false}], headers : {'x-schema' : '66'} },
          }
        };
        helper.eq(config.merge(_currentConfig, _newConfig),  {
          domains : {
            'client-1.myapp.net'     : { backends : [{url : 'http://21.10.10.11:8000'}, {url : 'http://10.10.10.10:8000', isReady : false}, {url : 'http://11.10.10.11:8000'}], headers : {'x-schema' : '66'} },
            'client-2.sub.myapp.net' : 'http://149.202.180.203:8103'
          }
        });
        helper.eq(_currentConfig, JSON.parse(JSON.stringify(_currentConfig)));
      });


      it('should return null if nothing has changed in backends even if the order of backend is not the same', function () {
        const _currentConfig = {
          domains : {
            'client-1.myapp.net'     : { backends : [{url : 'http://21.10.10.11:8000', isReady : false}, {url : 'http://10.10.10.10:8000'}, {url : 'http://11.10.10.11:8000'}], headers : {'x-schema' : '5000'} },
            'client-2.sub.myapp.net' : 'http://149.202.180.203:8103'
          }
        };
        const _newConfig = {
          domains : {
            'client-1.myapp.net'     : { backends : [{url : 'http://10.10.10.10:8000'}, {url : 'http://11.10.10.11:8000'}, {url : 'http://21.10.10.11:8000', isReady : false}], headers : {'x-schema' : '5000'} },
            'client-2.sub.myapp.net' : 'http://149.202.180.203:8103'
          }
        };
        helper.eq(config.merge(_currentConfig, _newConfig), null);
        helper.eq(_currentConfig, JSON.parse(JSON.stringify(_currentConfig)));
      });

      it('should change everything but it should not delete backends (merge mode)', function () {
        const _currentConfig = {
          port    : 4000,
          portSSL : 443,
          domains : {
            'client-1.myapp.net' : {
              backends   : [ {url : 'http://149.202.180.203:8000', isReady : true, version : '2'} ],
              headers    : {'x-schema' : '5000'},
              versioning : {
                header  : 'App-Version',
                default : '0',
              }
            },
            'client-2.sub.myapp.net' : 'http://149.202.180.203:8103'
          },
        };
        const _newConfig = {
          port    : 51,
          portSSL : 2,
          domains : {
            'client-1.myapp.net' : {
              backends   : [], // backend empty (but, in default merge mode, it never remove things)
              headers    : {'x-schema' : '66'},
              versioning : {
                header  : 'New-Version',
                default : '222',
              }
            }
          },
        };
        helper.eq(config.merge(_currentConfig, _newConfig),  {
          port    : 51,
          portSSL : 2,
          domains : {
            'client-1.myapp.net' : {
              backends   : [{url : 'http://149.202.180.203:8000', isReady : true, version : '2'}],
              headers    : {'x-schema' : '66'},
              versioning : {
                header  : 'New-Version',
                default : '222',
              }
            },
            'client-2.sub.myapp.net' : 'http://149.202.180.203:8103'
          },
        });
        helper.eq(_currentConfig, JSON.parse(JSON.stringify(_currentConfig)));
      });
    });
  });

  it('should add alternative domains that match with .myapp.net, and create an object {url: ...}', function () {
    var _config = {
      domains : {
        'client-1.myapp.net'     : 'http://149.202.180.203:8102',
        'client-2.sub.myapp.net' : 'http://149.202.180.203:8103',
        'client-3.myapp.net'     : 'http://149.202.180.203:8104',
        'client-3.myapp.com'     : 'http://149.202.180.203:8106', // other domain
      },
      alternativeDomains : {
        '.myapp.net' : ['.other.sub.ideolys.com', '.company.net']
      }
    };
    var _result = config.generateRuntimeDomains(_config);
    should(_result).containDeep({
      'client-1.myapp.net'               : { backends : [{url : 'http://149.202.180.203:8102', nbConnection : 0, isReady : true}], headers : null} ,
      'client-2.sub.myapp.net'           : { backends : [{url : 'http://149.202.180.203:8103', nbConnection : 0, isReady : true}], headers : null} ,
      'client-3.myapp.net'               : { backends : [{url : 'http://149.202.180.203:8104', nbConnection : 0, isReady : true}], headers : null} ,
      'client-3.myapp.com'               : { backends : [{url : 'http://149.202.180.203:8106', nbConnection : 0, isReady : true}], headers : null} ,
      'client-1.other.sub.ideolys.com'     : { backends : [{url : 'http://149.202.180.203:8102', nbConnection : 0, isReady : true}], headers : null} ,
      'client-2.sub.other.sub.ideolys.com' : { backends : [{url : 'http://149.202.180.203:8103', nbConnection : 0, isReady : true}], headers : null} ,
      'client-3.other.sub.ideolys.com'     : { backends : [{url : 'http://149.202.180.203:8104', nbConnection : 0, isReady : true}], headers : null} ,
      'client-1.company.net'               : { backends : [{url : 'http://149.202.180.203:8102', nbConnection : 0, isReady : true}], headers : null} ,
      'client-2.sub.company.net'           : { backends : [{url : 'http://149.202.180.203:8103', nbConnection : 0, isReady : true}], headers : null} ,
      'client-3.company.net'               : { backends : [{url : 'http://149.202.180.203:8104', nbConnection : 0, isReady : true}], headers : null}
    });
  });

  // TODO copy header in backend
  it.skip('should accept objects to set headers. Object should be cloned between domain and altrenative domain', function () {
    var _config = {
      domains : {
        'client-1.myapp.net' : { backends : [{url : 'http://149.202.180.203:8000'}], headers : {'x-schema' : '5000'}},
        'client-2.myapp.net' : { backends : [{url : 'http://149.202.180.203:8001'}], headers : {'x-schema' : '5001'}}
      },
      alternativeDomains : {
        '.myapp.net' : ['.other.sub.ideolys.com', '.company.net']
      }
    };
    var _result = config.generateRuntimeDomains(_config);
    should(_result).containDeep({
      'client-1.myapp.net'           : { backends : [{url : 'http://149.202.180.203:8000' , nbConnection : 0, isReady : true, headers : {'x-schema' : '5000'} }]},
      'client-2.myapp.net'           : { backends : [{url : 'http://149.202.180.203:8001' , nbConnection : 0, isReady : true, headers : {'x-schema' : '5001'} }]},
      'client-1.other.sub.ideolys.com' : { backends : [{url : 'http://149.202.180.203:8000' , nbConnection : 0, isReady : true, headers : {'x-schema' : '5000'} }]},
      'client-2.other.sub.ideolys.com' : { backends : [{url : 'http://149.202.180.203:8001' , nbConnection : 0, isReady : true, headers : {'x-schema' : '5001'} }]},
      'client-1.company.net'           : { backends : [{url : 'http://149.202.180.203:8000' , nbConnection : 0, isReady : true, headers : {'x-schema' : '5000'} }]},
      'client-2.company.net'           : { backends : [{url : 'http://149.202.180.203:8001' , nbConnection : 0, isReady : true, headers : {'x-schema' : '5001'} }]}
    });
    _result['client-1.myapp.net'].backends[0].nbConnection = 1;
    _result['client-1.other.sub.ideolys.com'].backends[0].nbConnection = 2;
    should(_result['client-1.company.net'].backends[0].nbConnection).equal(0);

  });

  it('should accept array of URL for load balancing. It should not modify current config', function () {
    var _config = {
      domains : {
        'client-1.myapp.net' : {
          backends : [
            { url : 'http://149.202.180.203:8000' },
            { url : 'http://149.202.180.203:8001' }
          ]
        }
      }
    };
    var _notMofidiedConfig = JSON.parse(JSON.stringify(_config));
    var _result = config.generateRuntimeDomains(_config);
    should(_result).containDeep({
      'client-1.myapp.net' : {
        backends : [
          { url : 'http://149.202.180.203:8000', nbConnection : 0, isReady : true },
          { url : 'http://149.202.180.203:8001', nbConnection : 0, isReady : true }
        ],
        headers : null
      }
    });
    should(_result).containDeep({
      'client-1.myapp.net' : {
        backends : [
          { url : 'http://149.202.180.203:8000', nbConnection : 0, isReady : true },
          { url : 'http://149.202.180.203:8001', nbConnection : 0, isReady : true }
        ],
        headers : null
      }
    });
    helper.eq(_config, _notMofidiedConfig);
  });

  it('should accept version an versioning parameters', function () {
    var _config = {
      domains : {
        'client-1.myapp.net' : {
          backends : [
            { url : 'http://149.202.180.203:8000', version : '1' },
            { url : 'http://149.202.180.203:8001', version : '2' }
          ],
          versioning : {
            header  : 'app-version',
            default : '1'
          }
        }
      }
    };
    var _result = config.generateRuntimeDomains(_config);
    should(_result).containDeep({
      'client-1.myapp.net' : {
        backends : [
          { url : 'http://149.202.180.203:8000', nbConnection : 0, isReady : true, version : '1' },
          { url : 'http://149.202.180.203:8001', nbConnection : 0, isReady : true, version : '2' }
        ],
        versioning : {
          header  : 'app-version',
          default : '1'
        },
        headers : null
      }
    });
  });

  it('should return an error if a unknown parameter is used in backend', function () {
    var _config = {
      domains : {
        'client-1.myapp.net' : {
          backends : [
            { uEl : 'http://149.202.180.203:8000' },
            { url : 'http://149.202.180.203:8001' }
          ]
        }
      }
    };
    should.throws(() => {
      config.generateRuntimeDomains(_config);
    }, /uEl in backend/);
  });

  it('should return an error if a unknown parameter is used in config', function () {
    var _config = {
      domains : {
        'client-1.myapp.net' : {
          backs : []
        }
      }
    };
    should.throws(() => {
      config.generateRuntimeDomains(_config);
    }, /backs in config/);
  });

  it('should return an error if the backend array is empty', function () {
    var _config = {
      domains : {
        'client-1.myapp.net' : {
          backends : []
        }
      }
    };
    should.throws(() => {
      config.generateRuntimeDomains(_config);
    }, /at least define one backend/);
  });

  it.skip('should return an error if the function cannot be stringified (depends on a variable, which is unreachable in a new scope)', function () {
    var _contextVar = { val : 1 }; // unreachable on worker
    var _config = {
      domains : {
        'client-1.myapp.net' : {
          backends        : [{ url : 'http://149.202.180.203:8000' }],
          loadBalancingFn : (req, backend) => {
            return _contextVar.val;
          }
        }
      }
    };
    should.throws(() => {
      config.generateRuntimeDomains(_config);
    }, /loadBalancingFn crashes if it is executed on workers/);
  });

});