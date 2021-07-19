const helper = require('./helper');
const log    = helper.logger('APP');
const params = require('./params.js');

/**
 * Check if the new config file is correct
 *
 * @param  {Object} oldConfig old config
 * @param  {Object} newConfig new config
 * @return {Object}           return null if new config is broken
 */
function checkConfig (oldConfig, newConfig) {
  if ( newConfig === undefined || newConfig === null || Object.keys(newConfig.domains).length === 0 ) {
    // if the current config does not contain domains also (first start of GoHA), quit immediately
    if ( oldConfig === undefined ) {
      throw new Error('Cannot start GoHA. Fix the configuration');
    }
    return null;
  }
  if (oldConfig !== undefined && oldConfig.port !== undefined && (newConfig.port !== oldConfig.port  )) {
    log.warn('Changed port and number are ignored, until GoHA restarts completely');
    newConfig.port  = oldConfig.port;
  }
  return newConfig;
}


/**
 * Generate runtime domains
 * It adds missing parameters (nbConnections, ...)
 *
 * @param  {Object} config  config file containing properties "domains" and "alternativeDomains". Example:
 *                          "alternativeDomains" = {
 *                            ".myapp.com" : [".other.myapp.com"]  // means generate new URLs, where .myapp.com is replaced by .other.myapp.com
 *                          }
 * @return {Object} config  add property "runtimeDomains" in config object, which contains all "domains" and duplicated "domains" using rules of "alternativeDomains"
 */
function generateRuntimeDomains (config) {
  let _runtimeDomains = {};
  let _config = JSON.parse(JSON.stringify(config)); // clone config to avoid modifying the source
  for (var _domain in _config.domains) {
    var _target = initDomainValues(_config.domains[_domain]);
    _runtimeDomains[_domain] = _target;

    // duplicate object for other domains
    for (var _domainFilterSuffix in _config.alternativeDomains) {
      var _altDomainSuffixes = _config.alternativeDomains[_domainFilterSuffix];
      if (_domain.endsWith(_domainFilterSuffix) === true) {
        var _domainPrefix = _domain.slice(0, -_domainFilterSuffix.length);
        if (_domainPrefix !== '') {
          for (var i = 0; i < _altDomainSuffixes.length; i++) {
            var _altDomainSuffix = _altDomainSuffixes[i];
            _runtimeDomains[_domainPrefix + _altDomainSuffix] = JSON.parse(JSON.stringify(_target));
          }
        }
      }
    }
  }
  return _runtimeDomains;
}


/* const configValidator = {
  port     : 80,
  portSSL  : 443,
  clusters : 5,
  domains  : (attr) => {
    // choice, either it is a string directly
    if (typeof(attr) === 'string') {
      return 'http://100.100.10.100:8103';
    }
    return {
      backends : [
        { url : 'http://100.100.10.100:8103', isReady : false, version : '2' },
      ],
      versioning : {
        header  : 'App-Version',
        default : '0'
      },
      loadBalancingFn : 'function'
    };
  },
  errorPage          : '',
  alternativeDomains : {}
};*/

/**
 * Merge configuration file with existing config
 *
 * @param   {Object}  current    The current
 * @param   {Object}  newConfig  The new configuration
 * @return  {Object}  null if the configuration has not changed
 */
function merge (current, newConfig) {
  if (typeof(newConfig) !== 'object') {
    return null;
  }
  let _hasDifference = 0;
  let _mergeConfig = JSON.parse(JSON.stringify(current));
  if (newConfig !== undefined && newConfig !== null) {
    _hasDifference = assignValue(_mergeConfig, newConfig);
  }
  return _hasDifference === 1 ? _mergeConfig : null;
}

/**
 * Assign new configuration value
 *
 * @param      {Object}  target      The target (current config)
 * @param      {Object}  source      The source : new config
 * @param      {String}  parentAttr  The parent attribute
 * @return     {Number}              return 1 if there is at least one difference
 */
function assignValue (target, source, parentAttr) {
  let _hasDifference = 0;
  let _backendURLs = [];
  // build a Set for backends to find existing backends rapidly
  if (parentAttr === 'backends' && target instanceof Array) {
    _backendURLs = target.map( a => a.url );
  }
  // merge
  for (let _attr in source) {
    let _targetAttr = _attr;
    // exception for backend, add a backend only if it does not exist
    if (parentAttr === 'backends') {
      _targetAttr = _backendURLs.indexOf(source[_attr].url);
      if (_targetAttr === -1) {
        _targetAttr = _backendURLs.length;
        _backendURLs.push(source[_attr].url);
        target.push(source[_attr]);
      }
    }
    // object or array (array is an object)
    if (typeof(source[_attr]) === 'object' && target[_targetAttr] !== undefined) {
      _hasDifference |= assignValue(target[_targetAttr], source[_attr], _attr);
    }
    else if (target[_targetAttr] !== source[_attr]) {
      _hasDifference = 1;
      target[_targetAttr] = source[_attr];
    }
  }
  return _hasDifference;
}


// https://stackoverflow.com/questions/16167581/sort-object-properties-and-json-stringify
// function JSONstringifyOrder( obj, space )
// {
//     var allKeys = [];
//     var seen = {};
//     JSON.stringify(obj, function (key, value) { if (!(key in seen)) { allKeys.push(key); seen[key] = null; } return value; });
//     allKeys.sort();
//     return JSON.stringify(obj, allKeys, space);
// }

/**
 * Basic checking and init values for one domain
 *
 * @param  {String|Object} domainObjOrString coming from config
 * @return {Object}                          domain object ready to be used at runtime
 */
function initDomainValues (domainObjOrString) {
  var _initDomain = {
    backends        : [],
    headers         : null,
    versioning      : null,
    loadBalancingFn : '(req, backend) => { return backend.nbConnection; }'
  };
  if (typeof(domainObjOrString) === 'string') {
    _initDomain.backends = [initBackendValues({ url : domainObjOrString})];
    return _initDomain;
  }
  // check domain attributes
  for (var _att in domainObjOrString) {
    if (_initDomain[_att] === undefined) {
      throw new Error(`Unknown params ${_att} in config file. Fix the config.js file`);
    }
    _initDomain[_att] = domainObjOrString[_att];
  }
  if (domainObjOrString.loadBalancingFn instanceof Function) {
    try {
      // let _strFn = eval(domainObjOrString.loadBalancingFn.toString());
      // _strFn({url : '/test'}, {url : 'http://10.10.10.10:3000', nbConnection: 0});
      _initDomain.loadBalancingFn = domainObjOrString.loadBalancingFn.toString();
    }
    catch (e) {
      throw new Error(`LoadBalancingFn crashes if it is executed on workers. Does it depends on external variable?. Fix the function ${domainObjOrString.loadBalancingFn.toString()} in config.js file: \n\n ${e}`);
    }
  }
  if ( !(_initDomain.backends instanceof Array) || _initDomain.backends.length === 0) {
    throw new Error('You must at least define one backend in config file. Fix the config.js file');
  }
  // init values of each backend target attributes
  for (var i = 0; i < _initDomain.backends.length; i++) {
    var _backend = _initDomain.backends[i];
    _initDomain.backends[i] = initBackendValues(_backend);
  }
  return _initDomain;
}

/**
 * Basic checking and init values for each backend at runtime
 *
 * @param  {Object} backend coming from config
 * @return {Object}         backend object ready to be used at runtime
 */
function initBackendValues (backend) {
  var _initBackend = {
    url          : '',
    nbConnection : 0,
    isReady      : true,
    version      : ''
  };
  for (var _att in backend) {
    if (_initBackend[_att] === undefined) {
      throw new Error(`Unknown params ${_att} in backend `+ JSON.stringify(backend) +' config file. Fix the config.js file');
    }
    _initBackend[_att] = backend[_att];
  }
  return _initBackend;
}


/**
 * Read config file
 * @param  {Object} oldConfig old config
 * @return {Object} config object with runtimeDomains property, or null if the config is broken
 */
function getConfig (oldConfig, isReadingRuntimeConfig = true) {
  const _configPath = (isReadingRuntimeConfig === true) ? params.CONFIG_RUNTIME_FILE : params.CONFIG_FILE;
  let _newConfig = null;
  let _newConfigPerDomain = null;
  try {
    delete require.cache[_configPath];
    _newConfig = require(_configPath);
  }
  catch (e) {
    log.error('Reading config file: ' + e);
    return null;
  }
  if (!checkConfig(oldConfig, _newConfig)) {
    return null;
  }
  try {
    _newConfigPerDomain = generateRuntimeDomains(_newConfig);
  }
  catch (e) {
    log.error('Parsing config file: ' + e);
    return null;
  }

  // log.info('Config reloaded');
  // log.info('' + JSON.stringify(_newConfig, null, 2));
  return { configSource : _newConfig, targetsPerDomain : _newConfigPerDomain };
}


module.exports = {
  getConfig              : getConfig,
  merge                  : merge,
  generateRuntimeDomains : generateRuntimeDomains // exposed only for testing purpose
};
