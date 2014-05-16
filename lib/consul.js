"use strict";
/**
 * Consul.io
 *
 * @see {@link http://www.consul.io/docs/agent/http.html}
 * @module
 */

/*
/v1/agent/checks                         : Returns the checks the local agent is managing
/v1/agent/services                       : Returns the services local agent is managing
/v1/agent/members                        : Returns the members as seen by the local serf agent
/v1/agent/join/<address>                 : Trigger local agent to join a node
/v1/agent/force-leave/<node>             : Force remove node
/v1/agent/check/register                 : Registers a new local check
/v1/agent/check/deregister/<checkID>     : Deregister a local check
/v1/agent/check/pass/<checkID>           : Mark a local test as passing
/v1/agent/check/warn/<checkID>           : Mark a local test as warning
/v1/agent/check/fail/<checkID>           : Mark a local test as critical
/v1/agent/service/register               : Registers a new local service
/v1/agent/service/deregister/<serviceID> : Deregister a local service

/v1/catalog/register          : Registers a new node, service, or check
/v1/catalog/deregister        : Deregisters a node, service, or check
/v1/catalog/datacenters       : Lists known datacenters
/v1/catalog/nodes             : [BLOCKING] Lists nodes in a given DC
/v1/catalog/services          : [BLOCKING] Lists services in a given DC
/v1/catalog/service/<service> : [BLOCKING] Lists the nodes in a given service
/v1/catalog/node/<node>       : [BLOCKING] Lists the services provided by a node
The last 4 endpoints of the catalog support blocking queries and consistency modes.

/v1/agent/checks                         : Returns the checks the local agent is managing
/v1/agent/services                       : Returns the services local agent is managing
/v1/agent/members                        : Returns the members as seen by the local serf agent
/v1/agent/join/<address>                 : Trigger local agent to join a node
/v1/agent/force-leave/<node>             : Force remove node
/v1/agent/check/register                 : Registers a new local check
/v1/agent/check/deregister/<checkID>     : Deregister a local check
/v1/agent/check/pass/<checkID>           : Mark a local test as passing
/v1/agent/check/warn/<checkID>           : Mark a local test as warning
/v1/agent/check/fail/<checkID>           : Mark a local test as critical
/v1/agent/service/register               : Registers a new local service
/v1/agent/service/deregister/<serviceID> : Deregister a local service

/v1/health/node/<node>       : [BLOCKING] Returns the health info of a node
/v1/health/checks/<service>  : [BLOCKING] Returns the checks of a service
/v1/health/service/<service> : [BLOCKING] Returns the nodes and health info of a service
/v1/health/state/<state>     : [BLOCKING] Returns the checks in a given state

/v1/status/leader : Returns the current Raft leader
/v1/status/peers  : Returns the current Raft peer set

*/

var request = require("request");
var util    = require("util");
var events  = require("events");
var assert  = require("assert-plus");
var Q       = require("q");

/**
 * Watches a path and emits the result when it changes.
 *
 * @constructor
 * @param {string} path - path to watch
 * @param {Object} [opts] - options
 * @param {string} opts.host - defaults to localhost
 * @param {Number} opts.port - defaults to 8500
 * @param {Number} opts.throttle - throttle requests to Consul; defaults to 1s
 */
function Watcher(path, opts) {
    if (! (this instanceof Watcher)) {
        throw new Error("constructor called without 'new'");
    }

    // == private functions and declarations
    
    var self = this;
    
    assert.optionalObject(opts, "opts");
    
    // default options
    opts = opts || {
        host: "localhost",
        port: 8500,
        throttle: 1000,
        wait: "1s",
    };
    
    assert.string(opts.host, "opts.host");
    assert.number(opts.port, "opts.port");
    assert.number(opts.throttle, "opts.throttle");
    assert.string(opts.wait, "opts.wait");
    assert.object(opts.logger, "opts.logger");
    
    var logger = opts.logger;
    
    var consulIndex;
    var lastRequest;
    
    // wrapper around normal request API that defaults to our host, port, json
    // opts
    var wrapper = request.defaults({
        url: util.format("http://%s:%d%s", opts.host, opts.port, path),
        json: true, // response bodies are json
        forever: true, // enable keep-alive; why not default??
    });
    
    function handleResponse(err, resp, body) {
        if (err) {
            return self.emit("error", err);
        }
        
        consulIndex = resp.headers["x-consul-index"];
        
        if (! consulIndex) {
            return self.emit("error", new Error(path + " does not support blocking queries"));
        }

        self.emit("response", body);
        
        // another request; infinite loop!
        poll();
    }
    
    function poll() {
        var reqOpts = {};
        if (consulIndex) {
            reqOpts.qs = {
                index: consulIndex,
                wait: opts.wait,
            };
        }
        
        // figure out delay; default to zero (execute immediately)
        var delay = 0;
        if (lastRequest) {
            // minimum delay is zero
            delay = Math.max(0, opts.throttle - (new Date() - lastRequest));
        }
        
        logger.trace("waiting %dms before retrieving %s", delay, path);

        Q.delay(delay).then(function() {
            logger.trace(reqOpts, "now retrieving %s", path);
            
            lastRequest = new Date();

            wrapper(reqOpts, handleResponse);
        });
        
    }
    
    // == public methods
    
    // == and finally initialization
    
    events.EventEmitter.call(this);
    
    // set it off!
    poll();
}

util.inherits(Watcher, events.EventEmitter);

/**
 * Consul
 *
 * @constructor
 * @param {Object} [opts] - options
 * @param {string} opts.host - defaults to localhost
 * @param {Number} opts.port - defaults to 8500
 */
function Consul(opts) {
    /**
     * Watch a path.  Must support blocking queries.
     *
     * @param {string} path - path to watch
     */
    this.watch = function(path) {
        return new Watcher(path, opts);
    };
}

module.exports = {
    /** Consul */
    Consul: Consul,
};
