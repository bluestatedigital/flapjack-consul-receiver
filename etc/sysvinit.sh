#!/bin/bash
#
# flapjack-consul-receiver Manage flapjack-consul-receiver
#       
# chkconfig:   2345 95 95
# description: flapjack-consul-receiver pushes check status from Consul to Flapjack
# processname: flapjack-consul-receiver
# pidfile: /var/run/flapjack-consul-receiver.pid

### BEGIN INIT INFO
# Provides:       flapjack-consul-receiver
# Required-Start: $local_fs $network
# Required-Stop:
# Should-Start:
# Should-Stop:
# Default-Start: 2 3 4 5
# Default-Stop:  0 1 6
# Short-Description: Manage flapjack-consul-receiver
# Description: flapjack-consul-receiver pushes check status from Consul to Flapjack
### END INIT INFO

# source function library
. /etc/rc.d/init.d/functions

prog="flapjack-consul-receiver"
user="nobody"
exec="/opt/flapjack/consul/bin/${prog}"
pidfile="/var/run/${prog}.pid"
lockfile="/var/lock/subsys/${prog}"
logfile="/var/log/${prog}.json"

start() {
    [ -x $exec ] || exit 5
    
    ## check for required config
    if [ -z "${redis_host}" ] || [ -z "${redis_port}" ] || [ -z "${redis_db}" ]; then
        exit 6
    fi

    umask 077

    touch $logfile $pidfile
    chown $user:$user $logfile $pidfile

    echo -n $"Starting ${prog}: "
    
    ## holy shell shenanigans, batman!
    ## daemon can't be backgrounded.  we need the pid of the spawned process,
    ## which is actually done via runuser thanks to --user.  you can't do "cmd
    ## &; action" but you can do "{cmd &}; action".
    daemon \
        --pidfile=${pidfile} \
        --user=${user} \
        " { ${exec} /etc/flapjack-consul-receiver.json &>> ${logfile} & } ; echo \$! >| ${pidfile} "
    
    RETVAL=$?
    echo
    
    [ $RETVAL -eq 0 ] && touch $lockfile
    
    return $RETVAL
}

stop() {
    echo -n $"Shutting down ${prog}: "
    
    killproc -p ${pidfile} ${prog}
    RETVAL=$?
    
    [ $RETVAL -eq 0 ] && success || failure

    echo
    [ $RETVAL -eq 0 ] && rm -f ${lockfile} ${pidfile}
    return $RETVAL
}

restart() {
    stop
    start
}

rh_status() {
    status -p "${pidfile}" -l ${prog} ${exec}
    
    RETVAL=$?
    
    [ $RETVAL -eq 0 ] && ${exec} members
    
    return $RETVAL
}

rh_status_q() {
    rh_status >/dev/null 2>&1
}

case "$1" in
    start)
        rh_status_q && exit 0
        $1
        ;;
    stop)
        rh_status_q || exit 0
        $1
        ;;
    restart)
        $1
        ;;
    status)
        rh_status
        ;;
    condrestart|try-restart)
        rh_status_q || exit 0
        restart
        ;;
    *)
        echo $"Usage: $0 {start|stop|status|restart|condrestart|try-restart}"
        exit 2
esac

exit $?
