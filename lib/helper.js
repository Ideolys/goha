
const package = require('../package.json');

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

module.exports = {
  printVersion
};
