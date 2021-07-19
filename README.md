GoHA
===

Extremely light and powerful Node JS reverse proxy


# Philosophy

  - Follows KISS (**Keep it simple, stupid**) principle, lighter than every other competitors
  - Focus on **High Performance** and **High availability**
  - Easy to fork and modify

# Feature

  - Flexible and easy routing
  - Easy to deploy and upgrade without downtime
  - Secured by default in a carefully systemd sandbox
  - Seamless SSL Support (HTTPS -> HTTP proxy)
  - Automatic HTTP to HTTPS redirects
  - Works with Let's Encrypt, activate https as soon as a certificate is available
  - Multi-thread (cluster by default)
  - DNS Failover
  - Websockets
  - Zero Point of Failure (multi-server master-slave config)
  - Zero downtime: register and unregister routes, add certificates without restarting
  - Passes tests of heavily used `node-http-proxy` module but without memory leaks and with better performance
  - Reload-safe: if config file is broken, it keeps previous config in memory (zero downtime)
  - Includes awesome statistics
    - top-10 slowest queries
    - histogram per hour, per response time
    - send real-time statistics to https://my-netdata.io/ (per domain, globally and per http status)


# Signal

The following signals will be used:

- WINCH: This tells the GoHA master process to gracefully stop its associated worker instances.
- USR2: Reload conf without restarting 
- HUP: This tells an GoHA master process to re-read its configuration files and replace worker processes with those adhering to the new configuration. If an old and new master are running, sending this to the old master will spawn workers using their original configuration.
- QUIT: This shuts down a master and its workers gracefully.
- TERM: This initiates a fast shutdown of the master and its workers.
- KILL: This immediately kills a master and its workers without any cleanup.


# Getting-started


### Systemd

- Install



### Node


- Create a config file

```bash
  vi config.json
```

- Run

```bash
  goha start
```

> by default, GoHA searches a config.json where it is executed


# Configuration 

GoHA can be configured with three methods
  - method 1 : a dynamic Javascript file which build and exports the JSON configuration file.
  - method 2 : a static JSON file
  - method 3 : an HTTP API, which updates the static JSON file. **Available only if the method 2 is used.**


Configuration files are stored in the working directory in `$GOHA_WORKDIR` (`/var/www/goha` by default)

```bash
  |- config.js            # [method 1] user-defined javascript which exports the configuration
  |- config.json          # [method 2] user-defined configuration file
  |- .config-runtime.json # last valid configuration file currently in production (DO NOT MODIFY).
  |- backup
    |- config-20210505121001.json # automatic backup of previous configuration file
    |- config-20210603121011.json # GoHA keeps only the last 7 days of configuration file.
  | middlewares 
    |- loadBalancing.js  # load balancing middleware functions    
    |- onRequest.js      # on request middleware
    |- onResponse.js     # on response middleware
  | public 
    |- 404.html          # defualt 404 html page error

```

#### All options of config.json


```json
  {
    "port" : 80,
    "portSSL" : 443,    // GoHA reads Let's Encript certificate automatically in /etc/letsencrypt/live
    "portAdmin" : 3000, // REST API to update configuration remotely (method 3) and dashboard + monitoring URLs
    "domains" : {
      // every request coming to blabla.company.net will be routed to http://100.100.100.100:8101
      "blabla.company.net" : "http://100.100.100.100:8101",
      "toto.company.net"   : "http://100.100.100.101:8102",
      // Underscore char can be used to deactivate a redirection wihout removing the line from the JSON
      "_titi.company.net"   : "http://100.100.100.101:8102",
      // Add custom headers like x-schema for ideos multitenant
      "saas-client-1.company.net" : { 
        "backends" : [{ "url" : "http://100.100.100.101:8102" }],
        "headers"  : {"x-schema" : "5000" }
      },
      // Manage Load balancing
      "saas-client-2.company.net" : {
        "backends" : [
          { "url" : "http://100.100.10.101:8102"                    }, // backend server 1
          { "url" : "http://100.100.10.101:8103"                    }, // backend server 2, ...
          { "url" : "http://100.100.10.100:8103", "isReady" : false }, // if isReady is false, no requests will be sent to this backend
          { "url" : "http://100.100.10.100:8104", "version" : "2"   }  // routing by version
        ],
        "versioning" : {
          "header"  : "App-Version", // case-insensitive version header name
          "default" : "0",           // default version if client has no version header
        },
        // Default load balancing method used if loadBalanceFn is undefined : Least Connection.
        // But you can overwrite it with this optional function.
        // For each request, a loop calls this function for each backend where isReady is true
        // It sends the request to the backend for which the function returns the lowest number
        // Be carefull, this function is stringified so you cannot use variable coming from outside
        "loadBalancingFn" : (req, backend) => { return backend.nbConnection; }, // [OPTIONAL]
        // custom error page if saas-client-2.company.net is not available
        "errorPage" : "custom404.html",
        // accept traffic coming from this interface only
        "listen" : "192.161.1.1"
      }
    },
    // default error page if a website is not available
    "errorPage" : "404.html",
    // Automatically generate new domains with duplication rules.
    // Ex. duplicate all domains URL replacing ".company.net" by ".1.alt.company.com" and ".2.alt.company.com"
    "alternativeDomains" : {
      ".company.net" : [".1.alt.company.com", ".2.alt.company.com"]
    }
  }
```

### REST API + Dashboard administration

GoHA listens `portAdmin` for administration if `portAdmin` is defined.

**⚠️ Be careful, this port should not be publicly exposed even if its protected ⚠️** .  You should allow access only through a VPN.

*List of APIs:*

- `GET  /      ` : [HTML] show a simple dashboard
- `POST /config` : [JSON] overwrite existing configuration. All missing element are deleted ⚠️
- `PUT  /config` : [JSON] merge with existing configuration (update and add elements only)
- `GET  /status` : [HTML] status of GoHA
- `GET  /metric` : [HTML] open metrics


#### PUT /config

The configuration sent by API is merged with the existing one. It adds missing domains, modify existing attributes and it does not delete anything

**Parameter**

The JSON format is exactly the same as the configuration file on the disk.

**Body**

```json
  {
    "domains" : {
      "blabla.company.net" : "http://100.100.100.100:8101", // add a domain
    }
  }
```

**Response**:

It returns the whole config

```json
  {
    "domains" : {
      "blabla.company.net" : "http://100.100.100.100:8101",
      "toto.company.net"   : "http://100.100.100.101:8102"  // existing config
    }
  }
```



# Internal Workflow


- The master starts
  - It copies `config.json` to `.config-runtime.json` if the latter does not exists
  - It starts workers

- When a worker starts
  - It read only `.config-runtime.json`

- When the signal to reload conf is read
  - The master catch the signal
  - It sends a message to one worker to read the new `config.json` instead of  `.config-runtime.json` if it has changed
  - If the worker reloads the configuration with succeed, it send a "success" signal to the master
  - If the master receive the success signal, it replaces `.config-runtime.json` by `config.json` and create a backup of the previous config in backups dir
  - and it sends a signal to all other workers to reload the conf


`.config-runtime.json`  can be different from `config.json` if the latter contains an error for example and cannot be loaded.
 In that case, `.config-runtime.json` is used as a backup to keep the last working configuration in production


The config file is Javascript file. So you can write code to generate a dynamic config file.
This file must export the config object.

> If you prefer to use a pure JSON file, you can write a `config.js` file which contains `module.exports = require('./myConfig.json')`

If the file contains an error, the file is ignored and GoHA keep using the previous valid config file, which is stored in memory and on disk config.runtime.js


### Javascript mode :

```javascript
  var config = {}; // same config as before
  module.exports = config;
```


At startup, goha search a config.js where it is executed.

If the port 80 is used, allow users to execute Nodejs on port 80 with this command:

```
sudo setcap 'cap_net_bind_service=+ep' ~/.nvm/current/bin/node   # adapt the path if necessary
```

# How to see logs?

Log format : `"[TYPE]"  "LEVEL"  "message"`

- `[TYPE]` can be 
  - `[APP]` : application message, such as config reload, start/stop info
  - `[REQ]` : request logs

- `LEVEL` can be
  - `INFO`  : general info messages
  - `ERROR` : error messages
  - `WARN`  : carning messages

- `message` can be
  - for `[APP]` message, general info
  - for `[REQ]` see format below

    [REQ] INFO 192.168.1.1 www.mysite.com http://192.161.1.10:3001 GET /css/main.css unique_request_id
    [REQ] INFO 192.168.1.1 www.mysite.com http://192.161.1.10:3001 GET /css/main.css unique_request_id



GoHA write and rotates logs in `/logs` of the working directory, next to `config.js`.

The log retention is defined in `lib/logger.js:LOG_RETENTION` (10 days).

Use `goha logs`. It is a shortcut of `tail -f logs/out.log`

Logs output:

```
  Date                ipSource    ->  hostSource       -> ipTarget                  : Method URL
  2016-08-24 16:27:06 192.168.1.1 ->  www.myapp.com  -> http://37.59.175.179:3001 : GET    /css/main.css
  2016-08-24 16:27:06 192.168.1.1 ->  www.myapp.com  -> http://37.59.175.179:3001 : GET    /undefined
  2016-08-24 16:27:06 192.168.1.1 ->  www.myapp.com  -> http://37.59.175.179:3001 : GET    /favicon.ico 
```

# Version routing

GoHA can route packets according to version header. Each backend must have a version.

```js
  'saas-client-2.company.net' : {
    backends : [
      { url : 'http://100.100.10.101:8102', version : '1'          },
      { url : 'http://100.100.10.100:8104', version : '2'          }, // matches with version '2', '2.0', '2.1.1-beta'
      { url : 'http://100.100.10.100:8105', version : '2.1'        }, // matches with version '2.1', '2.1.2', '2.1.2-beta'
      { url : 'http://100.100.10.100:8106', version : '2010-01-01' }  // matches with version '2010-01-01', '2010-01-01.1020'
    ],
    versioning : {
      header  : 'App-Version', // case-insensitive version header name
      default : '1'            // default version if client has no version header
    }
  }
```

If there is a conflicts, GoHA selects the backend which has the longest version string.
In the example above, if the client has a header `"App-Version" : "2.1"`, the backend which has the port 8105 is choosen.


# How to activate SSL?


GoHA redirects automatically the client to https if there is a corresponding certificate for the domain in `/etc/letsencrypt/live`.

GoHA does not generate and renew cerificates himself (For the moment, it must be done manually or in a cron tab).

Let's encrypt does not accept wildcard certificates, so we must generate one certificate per sub-domain/domain.

Let's encrypt cannot generate more than 5 certificates per week (rate limit), so take your time ;).


1. Install Let's encrypt

    On ubuntu 16.04 LTS (source : https://certbot.eff.org/#ubuntuxenial-other)
    
    ```
    sudo apt-get install software-properties-common
    sudo add-apt-repository ppa:certbot/certbot
    sudo apt-get update
    sudo apt-get install certbot
    ```

2. Generate a certificate for one domain

    ```
      certbot certonly --webroot -w /var/www/goha/public -d failover.myapp.net
    ```
    
    **When the first certificate is created, change owner of these directory to make it GoHA-accessible:**
    
    ```
      sudo chown -R ubuntu:ubuntu /etc/letsencrypt/
      sudo chown -R ubuntu:ubuntu /var/log/letsencrypt/
      sudo chown -R ubuntu:ubuntu /var/lib/letsencrypt/
    ```

3. Reload GoHA

    `goha reload`


# How to renew SSL Certificates ?

Each month, renew all certificates in a cron tab with

```
certbot renew
cd /var/www/goha/
goha reload
```

# DNS Let encrypt

https://buzut.net/certbot-challenge-dns-ovh-wildcard/


# Load balancing

GoHA can be used for load balancing between many backends servers defined in an array like this:

```js
'saas-client-1.company.net' : {
  backends : [
    { url: 'http://100.100.100.10:8102'                    },
    { url: 'http://100.100.100.101:8102' , isReady : false },// if isReady is false, no requests will be sent to this backend
    { url: 'http://100.100.100.101:8103'                   } // by default : isReady : true
  ],
  loadBalancingFn : (req, backend) => { return backend.nbConnection }
}
```

GoHA uses "the least connections" algorithm by default.
Read [this doc](https://d2c.io/post/haproxy-load-balancer-part-2-backend-section-algorithms) about all possible load balancing algorithms

But you can overwrite with your own function or one of these built-in functions :

```js
  /**
   * If the request is a GET, it redirects the URL `/render/<base64IPv4` to the
   * backend which matches with the <base64IPv4> encoded with Buffer.from('127.0.0.2'.padEnd(15, ' ')).toString('base64');
   */
  loadBalancing.selectBackendUsingBase64IP(/^\/render\/(.*)/)
```

# Development philosophy

Only the master read the config file. It validates it and send it to workers only if everything is ok.

# Commands

These commands must be executed in the working directory of GoHA.

```
Actions :
  start      : Start your proxy
  log        : Shows logs in realtime
  err        : Shows error logs in realtime
  reload     : Reloads your proxy one cluster at a time to keep your front alive
               Usually used when updating your conf and certificates
  restart    : Restarts completely your proxy with service interruption
               Usually used when upgrating goha
  stop       : Stops your proxy
```



Grabage collector : https://plaid.com/blog/how-we-parallelized-our-node-service-by-30x/
Header security https://cheatsheetseries.owasp.org/cheatsheets/Nodejs_Security_Cheat_Sheet.html





------------

TODO

TODO: https://about.ip2c.org/#about

Regarder https://github.com/agnoster/duplicator
