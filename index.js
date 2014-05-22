#!/usr/bin/env node

"use strict";

var bunyan = require("bunyan");
var Q      = require("q");
var Redis  = require("redis");
var StatsD = require("node-statsd").StatsD;
var fs     = require("fs");
var assert = require("assert-plus");

if (process.argv.length != 3) {
    console.error("usage: " + process.argv[1] + " /path/to/config.json");
    process.exit(1);
}

var config = JSON.parse(fs.readFileSync(process.argv[2]));

assert.object(config, "config");

assert.object(config.redis, "redis");
assert.string(config.redis.host, "redis.host");
assert.number(config.redis.port, "redis.port");
assert.number(config.redis.db,   "redis.db");

var statsd = new StatsD({ mock: true });

if (config.statsd) {
    assert.object(config.statsd, "statsd");
    assert.string(config.statsd.host, "statsd.host");
    assert.number(config.statsd.port, "statsd.port");
    
    statsd = new StatsD({
        host: config.statsd.host,
        port: config.statsd.port,
        prefix: "flapjack.consul.",
    });
}

var logger = bunyan.createLogger({
    name: "flapjack-consul-receiver",
    stream: process.stdout,
    level: "info",
});

var consul = new (require("./lib/consul").Consul)({
    host: "localhost",
    port: 8500,
    throttle: 60000,
    wait: "1m",
    logger: logger,
});

var redis = Redis.createClient(config.redis.port, config.redis.host);

redis.on("error", function(err) {
    logger.fatal(err, "got a redis error");
    
    // throw it, 'cause this is fatal, yo.
    throw err;
});

function handleHealthStatuses(stateName, statuses) {
    /*
    [ { Node: 'web-fwork-gen-006.us-east-1.aws.prd.bsdinternal.com',
        CheckID: 'service:client-hkstrategies',
        Name: 'Service \'client-hkstrategies\' check',
        Status: 'critical',
        Notes: '',
        Output: 'failed in 3ms: 500 -- Bad status code\n\n',
        ServiceID: 'client-hkstrategies',
        ServiceName: 'client-hkstrategies' },
      { Node: 'web-fwork-gen-005.us-east-1.aws.prd.bsdinternal.com',
        CheckID: 'service:client-maffei',
        Name: 'Service \'client-maffei\' check',
        Status: 'critical',
        Notes: '',
        Output: 'failed in 8ms: 500 -- Bad status code\n\n',
        ServiceID: 'client-maffei',
        ServiceName: 'client-maffei' } ]
    */
    
    logger.debug({ stateName: stateName }, "got %d status records", statuses.length);
    
    statsd.increment("health." + stateName, statuses.length);
    
    // consul => flapjack
    var STATE_MAP = {
        "passing":  "ok",
        "warning":  "warning",
        "critical": "critical",
        "unknown":  "unknown",
    };
    
    var DEFAULT_SUMMARY_MAP = {
        "passing":  "(•‿•)",
        "warning":  "ಠ_ಠ",
        "critical": "(╯°□°）╯︵ ┻━┻",
        "unknown":  "¯\\_(ツ)_/¯",
    };
    
    if (Array.isArray(statuses) && statuses.length) {
        var multi = redis.multi();
        
        statuses.forEach(function(status) {
            if (status.Status !== "passing") {
                logger.info(status);
            }
            
            var evt = {
                "entity":  status.Node,
                "check":   status.CheckID,
                "type":    "service",
                "state":   STATE_MAP[status.Status],
                "summary":  DEFAULT_SUMMARY_MAP[status.Status], // must exist, be non-empty
                "details": status.Output,
                "time":    Math.floor((new Date()).getTime() / 1000),
            };
            
            if (status.Output && status.Output.length) {
                evt.summary = status.Output.split("\n")[0];
            }
            
            // keep in sync with flapjack-nagios-receiver
            statsd.increment("events");
            
            multi.lpush("events", JSON.stringify(evt));
        });
        
        multi.exec(function(err /*, replies */) {
            if (err) {
                logger.error(err, "unable to push events to redis");
            }
        });
    }
}


Q
    .ninvoke(redis, "once", "connect")
    .then(function() {
        logger.info("connected to redis");
        
        return Q.ninvoke(redis, "select", config.redis.db);
    })
    .then(function() {
        logger.debug("selected db %d", config.redis.db);
        
        consul.watch("/v1/health/state/passing").on("response", function(statuses) {
            handleHealthStatuses("passing", statuses);
        });
        
        consul.watch("/v1/health/state/critical").on("response", function(statuses) {
            handleHealthStatuses("critical", statuses);
        });
        
        consul.watch("/v1/health/state/warning").on("response", function(statuses) {
            handleHealthStatuses("warning", statuses);
        });
        
        consul.watch("/v1/health/state/unknown").on("response", function(statuses) {
            handleHealthStatuses("unknown", statuses);
        });
    })
    .done();
