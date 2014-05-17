# flapjack-consul-receiver

Pumps [Consul][consul] check state into [Flapjack][flapjack].  Must run
alongside a Consul agent listening on port 8500 (the default).

## how it works

Four blocking queries are initiated for each of the four health state API
endpoints (`/v1/health/state/critical`, for example).  Whenever they change --
and no more frequently than once per minute -- the results are fed to the Redis
database used by Flapjack, just like the `flapjack-nagios-receiver`.

## running

Quick 'n dirty:

1. clone this repo
2. `npm install`
3. `./index.js $REDIS_HOST $REDIS_PORT $REDIS_DB`

The Redis connection info must match the `redis` config block of your
`flapjack_config.yaml`.

## packaging

RPM (RedHat, CentOS):

1. clone this repo
2. `npm install`
3. `node_modules/.bin/grunt ci`

The RPM will be put into the `target` directory.  There's an init script so you
can do `service flapjack-consul-receiver start`.  You must provide Redis
connection info in `/etc/sysconfig/flapjack-consul-receiver`.

[consul]: http://consul.io/
[flapjack]: http://flapjack.io/
