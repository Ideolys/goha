module.exports = {

  /**
   * Generate a load balancing middleware with can force a backend for some URLs
   *
   * @param  {Object} regexp   regexp to extract IP from URLs and redirect to the corresponding backend
   * @return {Function}        middleware
   */
  selectBackendUsingBase64IP : function (regexp) {
    /**
     * Middleware for load balancing
     * Redirect to the backend which matches with the base64 IP with padding in the URL
     *
     * @param  {Object} req      NodeJS req
     * @param  {Object} backend  backend object coming from routing config
     * @return {Number}          return 0 if both the backend and the URL match
     *                                  1 if only the URL matches
     *                                  current number of connection of the backend otherwise
     */
    function computePriority (req, backend) {
      var _ip = this.regexp.exec(req.url);
      if (_ip instanceof Array && _ip.length > 1 && req.method === 'GET') {
        var _base64ip = _ip[1].substr(0, 20);
        var _decodedIP = Buffer.from(_base64ip, 'base64').toString().trimRight();
        // remove port in backend URL
        var _backendIp = backend.url.replace(/:\d+\s*$/, '');
        if (_backendIp.endsWith(_decodedIP) === true) {
          return Number.MIN_SAFE_INTEGER;
        }
        return 1;
      }
      return backend.nbConnection;
    }
    // The context (variables coming from outside) must be included in the function.
    // But we cannot use Function.bind because the function cannot be stringified with "bind". So we dot it "manually".
    // It seems strange but it is compliant with the philosophy of GoHA: only the master parses the config file and
    // send a "sanitized/optimized" version to all workers
    var _functionReadyToStringify = computePriority.toString()
      .replace(/^function computePriority \(req, backend\) {|\}$/g, '')
      .replace('this.regexp', regexp);
    return new Function('req', 'backend', _functionReadyToStringify);
  }
};