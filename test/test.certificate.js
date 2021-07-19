const certificates = require('../lib/certificates.js');
const helper       = require('../lib/helper.js');


describe('certificates', function () {
  describe('resolveWildcardCertificate', function () {

    it('should duplicate certificates object for each matching domain', function () {
      var _domains = {
        'dev.master.domain.com' : {},
        'master.domain.com'     : {},
        'other.fr'              : {},
        'domain.com'            : {}
      };
      var _certificates =  {
        'domain.com' : { cert : 'key1' },
        'other.fr'   : { cert : 'key2' },
      };
      certificates.resolveWildcardCertificate(_certificates, _domains);
      helper.eq(_certificates, {
        'domain.com'            : { cert : 'key1' },
        'other.fr'              : { cert : 'key2' },
        'dev.master.domain.com' : { cert : 'key1' },
        'master.domain.com'     : { cert : 'key1' },
      });
    });

    it('should keep subdomain certificate, even if there is a wildcard certificate', function () {
      var _domains = {
        'dev.master.domain.com' : {},
        'master.domain.com'     : {},
        'other.fr'              : {},
        'domain.com'            : {}
      };
      var _certificates =  {
        'domain.com'        : { cert : 'domain' },
        'master.domain.com' : { cert : 'master' },
      };
      certificates.resolveWildcardCertificate(_certificates, _domains);
      helper.eq(_certificates, {
        'domain.com'            : { cert : 'domain' },
        'master.domain.com'     : { cert : 'master' },
        'dev.master.domain.com' : { cert : 'master' }
      });
    });

    it('should no nothing if there is no certificates', function () {
      var _domains = {
        'dev.master.domain.com' : {},
        'master.domain.com'     : {},
        'other.fr'              : {},
        'domain.com'            : {}
      };
      var _certificates =  {};
      certificates.resolveWildcardCertificate(_certificates, _domains);
      helper.eq(_certificates, {});
    });

    it('should no nothing if there is no certificates', function () {
      var _domains = {
        'dev.master.domain.com' : {},
        'master.domain.com'     : {},
        'other.fr'              : {},
        'domain.com'            : {}
      };
      helper.eq(certificates.resolveWildcardCertificate(null, _domains), null);
    });
    it('should no nothing if there is no runtimeDomain', function () {
      var _certificates =  {
        'domain.com'        : { cert : 'domain' },
        'master.domain.com' : { cert : 'master' },
      };
      certificates.resolveWildcardCertificate(_certificates, null);
      helper.eq(_certificates, {
        'domain.com'        : { cert : 'domain' },
        'master.domain.com' : { cert : 'master' },
      });
    });
  });


});