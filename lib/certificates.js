const fs              = require('fs');
const path            = require('path');
const tls             = require('tls');
const execSync        = require('child_process').execSync;
const helper          = require('./helper');
const log             = helper.logger('APP');
const CERTS_PATH      = '/etc/letsencrypt/live';
const CERT            = 'cert.pem';
const FULLCHAIN       = 'fullchain.pem';
const PRIVKEY         = 'privkey.pem';

const DEFAULT_PRIVKEY = path.join(process.cwd(), 'privkey.pem');
const DEFAULT_CERT    = path.join(process.cwd(), 'cert.pem');


/**
 * Get Lets Encrypt Certificates
 * @return {[type]}            [description]
 */
function getLetsEncryptCertificates () {
  var _certificates = {};
  if (fs.existsSync(CERTS_PATH) === false) {
    log.info('LetsEncrypt directory not detected (or no access) ' + CERTS_PATH);
    log.warn('SSL Disabled');
    return _certificates;
  }
  var _dirs = fs.readdirSync(CERTS_PATH, { withFileTypes : true, encoding : 'utf8'});
  for (var i = 0; i < _dirs.length; i++) {
    var _domain = _dirs[i];
    if (_domain.isDirectory() === true) {
      let _key       = fs.readFileSync(path.join(CERTS_PATH, _domain.name, PRIVKEY), 'utf8');
      let _cert      = fs.readFileSync(path.join(CERTS_PATH, _domain.name, CERT), 'utf8');
      let _fullchain = fs.readFileSync(path.join(CERTS_PATH, _domain.name, FULLCHAIN), 'utf8');
      _certificates[_domain.name] = tls.createSecureContext({ key : _key, cert : _cert + _fullchain }).context;
    }
  }
  return _certificates;
}

/**
 * Generate a default Certificate
 *
 * @return {[type]} [description]
 */
function createDefault () {
  if (fs.existsSync(DEFAULT_PRIVKEY) === false) {
    const _cert = '/C=FR/ST=FR/L=Paris/O=Goha/OU=Goha/CN=localhost/emailAddress=no@goha.io';
    execSync('openssl req -new -newkey rsa:4096 -days 3650 -nodes -x509 -subj "'+_cert+'" -keyout '+DEFAULT_PRIVKEY+' -out '+DEFAULT_CERT);
  }
}

/**
 * Generate a default Certificate
 * TODO SECURITY : USE Elliptcal Curve Key http://stackoverflow.com/questions/10185110/key-generation-requirements-for-tls-ecdhe-ecdsa-aes128-gcm-sha256/10185909#10185909 
 * openssl ecparam -name secp521r1 -out ca-key.pem -genkey
 * @return {[type]} [description]
 */
function getDefaultCertificate () {
  return {
    privkey : fs.readFileSync(DEFAULT_PRIVKEY),
    cert    : fs.readFileSync(DEFAULT_CERT)
  };
}

function resolveWildcardCertificate (certificates, runtimeDomains) {
  if (!(certificates instanceof Object)) {
    return certificates;
  }
  // for each declared domain in runtimeDomain, try to find the corresponding certificate
  for (let _runtimeDomain in runtimeDomains) {
    let _domainWithoutSubdomain = _runtimeDomain;
    while (certificates[_domainWithoutSubdomain] === undefined && _domainWithoutSubdomain.indexOf('.') > 1) {
      _domainWithoutSubdomain = _domainWithoutSubdomain.replace(/^[^.]+\./, '');
    }
    if ( certificates[_domainWithoutSubdomain] !== undefined ) {
      certificates[_runtimeDomain] = certificates[_domainWithoutSubdomain];
    }
  }
  return  certificates;
}

module.exports = {
  getLetsEncryptCertificates : getLetsEncryptCertificates,
  getDefaultCertificate      : getDefaultCertificate,
  createDefault              : createDefault,
  resolveWildcardCertificate : resolveWildcardCertificate
};

