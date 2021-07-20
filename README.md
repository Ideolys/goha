GoHA
====

Extremely light and powerful Node JS reverse proxy and forward-proxy


# Philosophy

  - Follows KISS (**Keep it simple, stupid**) principle, lighter than every other competitors
  - Focus on **High Performance** and **High availability**
  - Easy to fork and modify

# Features

  - Flexible and easy routing
  - Easy to deploy and upgrade without downtime
  - Secured by default in a carefully systemd sandbox
  - Seamless SSL Support (HTTPS -> HTTP proxy)
  - Automatic HTTP to HTTPS redirects
  - Works with Let's Encrypt, activate https as soon as a certificate is available
  - Multi-thread (cluster by default)
  - DNS Failover
  - Websockets, HTTP2
  - Zero Point of Failure (multi-server master-slave config)
  - Zero downtime: register and unregister routes, add certificates without restarting
  - Passes tests of heavily used `node-http-proxy` module but without memory leaks and with better performance
  - Reload-safe: if config file is broken, it keeps previous config in memory and in the disk (zero downtime)
  - (TODO) Includes awesome statistics
    - top-10 slowest queries
    - histogram per hour, per response time
    - send real-time statistics to Netdata



# Getting-started

## In production with systemd (Ubuntu/Debian ONLY)

GoHA relies on systemd to run with a high level of security and availability.

It provides automatic deployment scripts and a CLI for administration

```bash
  # Execute the installation command directly from the binary and follow instructions
  ./goha-x-x-x install
```

Now GoHA is installed and running. See the Configuration part below to configure the proxy.

> By default, the service is installed in `/usr/local/bin/goha` and run with `goha` user.
> The working directory, where the configuration is stored, is `/var/www/goha`.
> It is possible to overwrite this values with environment variables `GOHA_USER` and `GOHA_WORKDIR`.

## In development


```bash
  npm install
  # start the proxy locally without systemd
  bin/goha go
  # tests
  npm test
  # build binary and tag (You must manually update version in package.json before)
  npm run build
```



# Command Line Interface

```bash
  goha [commands]

  #  Production commands. For Linux only, GoHA must be installed before:
  #
  #    start          : Start the proxy
  #    stop           : Stops the proxy
  #    reload         : Reloads the configuration or upgrade seamlessly (no socket lost, no packet lost)
  #    log            : Shows logs in realtime
  #    restart        : Restarts completely the proxy with service interruption
  #    --version [-v] : Get current version
  #    --help [-h]    : Show this help
  #
  #  Installation and tests commands:
  #
  #    install  : Install the proxy as a systemd service (Linux only)
  #               Options:
  #                 --non-interactive : install without user interaction
  #                 --no-start        : do not start or restart service
  #    go       : Start the proxy without systemd, only for test purpose
  #
```




# Configuration 

GoHA can be configured with three methods
  - **[method 1]** : a static JSON file
  - **[method 2]** : an HTTP API, which updates the static JSON file. **Available only if the method 1 is used.**
  - **[method 3]** : a dynamic Javascript file which build and exports the JSON configuration file.

Configuration files are stored in the working directory in `$GOHA_WORKDIR` (`/var/www/goha` by default).

Here is the file structure of the working directory:

```bash
  |- config.json          # [method 1] user-defined configuration file
  |- config.js            # [method 3] user-defined javascript which exports the configuration
  |- .config-runtime.json # last valid configuration file currently used in production (DO NOT MODIFY).
  |- backup
    |- config-20210505121001.json # automatic backup of previous configuration file
    |- config-20210603121011.json # GoHA keeps all history for the moment
  | middlewares 
    |- loadBalancing.js  # (TODO) load balancing middleware functions    
    |- onRequest.js      # (TODO) on request middleware
    |- onResponse.js     # (TODO) on response middleware
  | public 
    |- 404.html          # (TO_IMPROVE) default mainteance or 404 error page

```


## [method 1] config.json

Here are all options available in `config.json` 

```js
  {
    "port" : 80,
    "portSSL" : 443,    // GoHA reads Let's Encript certificate automatically in /etc/letsencrypt/live
    "portAdmin" : 3000, // REST API to update configuration remotely (method 2) and dashboard + monitoring URLs
    "domains" : {
      // every request coming to blabla.company.net will be routed to http://100.100.100.100:8101
      "blabla.company.net" : "http://100.100.100.100:8101",
      "toto.company.net"   : "http://100.100.100.101:8102",
      // Underscore char can be used to deactivate a redirection wihout removing the line from the JSON [TODO]
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
        "loadBalancingFn" : "", // [TODO]
        // custom error page if saas-client-2.company.net is not available
        "errorPage" : "custom404.html", // [TODO]
        // accept traffic coming from this interface only
        "listen" : "192.161.1.1" // [TODO]
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

## [method 2] REST API + Dashboard administration

GoHA listens `portAdmin` for administration if `portAdmin` is defined.

**⚠️ Be careful, this port should not be publicly exposed even if its protected ⚠️** . You should allow access only through a VPN.

*List of APIs:*

- `GET  /      ` : [HTML] show a simple dashboard (TODO) 
- `GET  /config` : [JSON] get current runtime config
- `POST /config` : [JSON] overwrite existing configuration. All missing element are deleted ⚠️
- `PUT  /config` : [JSON] merge with existing configuration (update and add elements only)
- `GET  /status` : [HTML] status of GoHA (TODO)
- `GET  /metric` : [HTML] open metrics (TODO)


### PUT /config

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

It returns the whole config in "data" attribute

```json
  {
    "data": {
      "domains" : {
        "blabla.company.net" : "http://100.100.100.100:8101",
        "toto.company.net"   : "http://100.100.100.101:8102"  // existing config
      },
    "message" : "success message"
  }
```


## [method 3] Javascript mode

The config file can be a dynamic Javascript file. So you can write code to generate a dynamic config file.

This file must export the config object.

```javascript
  let config = {}; // same config as explained earlier
  module.exports = config;
```

> ⚠️ `config.js` is ignored if there is a `config.json` in the working directly.




## Internal workflow

The master does little things. Everything is done in workers.

- The master starts
  - It copies `config.json` to `.config-runtime.json` if the latter does not exists
  - It starts workers

- When a worker starts
  - It read only `.config-runtime.json`

- When the signal to reload the configuration is received
  - The master catches the signal
  - The master sends a message to one worker to test the new `config.json` 
  - If the worker can read the configuration with success, it sends a "success" signal to the master
  - If the master receives the "success" signal, it replaces `.config-runtime.json` by the content of `config.json` and creates a backup of the previous config in `backup` directory
  - The master sends a signal to all workers to really reload the configuration by reading `.config-runtime.json`


`.config-runtime.json`  can be different from `config.json` if the latter contains an error and cannot be loaded.
In that case, `.config-runtime.json` is used as a backup to run the last working configuration in production (Very useful when the machine restarts).



# Logging

You can use `goha log` to logs in live mode. It is a shortcut of `journalctl -n 500 -f -u $GOHA_SERVICE_NAME`


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


> GoHA relies on systemd to lotates logs


Logs output (TODO)
```
  [REQ] INFO 192.168.1.1 www.mysite.com http://192.161.1.10:3001 GET /css/main.css unique_request_id
  [REQ] INFO 192.168.1.1 www.mysite.com http://192.161.1.10:3001 GET /css/main.css unique_request_id 
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



### How to renew SSL Certificates ?

Each month, renew all certificates in a cron tab with

```
certbot renew
cd /var/www/goha/
goha reload
```

### DNS Let encrypt

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

