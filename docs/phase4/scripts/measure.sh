#!/bin/bash
# Cold boot of a stripped web-profile Host from the built CLI: time to a
# listening port, time to the printed URL, idle RSS after 3 s.
# usage: measure.sh <fresh DSH_HOME> <port>   (after `pnpm run build`)
H=$1; PORT=$2; S=$(cd "$(dirname "$0")" && pwd); ROOT=$(cd "$S/../../.." && pwd)
mkdir -p $S/ws; cd $S/ws
T0=$(python3 -c 'import time;print(time.time())')
DSH_HOME=$H node "$ROOT/apps/cli/lib/bin.js" web --no-open --port $PORT > $S/web-$PORT.log 2>&1 &
PID=$!
while true; do c=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:$PORT/ 2>/dev/null); [ "$c" != "000" ] && break; sleep 0.05; done
T1=$(python3 -c 'import time;print(time.time())')
while ! grep -q 'dsh web: http' $S/web-$PORT.log; do sleep 0.05; done
T2=$(python3 -c 'import time;print(time.time())')
sleep 3
R=$(ps -o rss= -p $PID)
echo "pid=$PID http_listen=$(python3 -c "print(round($T1-$T0,2))")s url_printed=$(python3 -c "print(round($T2-$T0,2))")s rss_idle_MB=$((R/1024))"
