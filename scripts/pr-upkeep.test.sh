#!/usr/bin/env bash
# Tests the working-group merge decision in pr-upkeep.sh (wg_verdict). Exit code only.
set -uo pipefail
source "$(dirname "$0")/pr-upkeep.sh"
FAIL=0
t() { local want=$1 got; shift; got=$(wg_verdict "$@"); [ "$got" = "$want" ] && echo "ok   $want" || { echo "FAIL want '$want' got '$got'"; FAIL=1; }; }

line='<!-- wg-quorum --> builder=agent:tpr-builder reviewer=%s gates=green@abc123 mandate=srs-rust#1 verdict=%s'
c() { jq -n --arg b "$(printf "$line\nfindings: none" "$1" "$2")" --arg at "$3" '[{body:$b,created_at:$at,author_association:"OWNER"}]'; }
COMMIT=2026-10-12T10:00:00Z; AFTER=2026-10-12T11:00:00Z; BEFORE=2026-10-12T09:00:00Z

t ok                                                    1 "$(c agent:tpr-reviewer approve $AFTER)" $COMMIT 3
t "builder and reviewer are the same actor"             1 "$(c agent:tpr-builder approve $AFTER)" $COMMIT 3
t "quorum comment older than the last commit"           1 "$(c agent:tpr-reviewer approve $BEFORE)" $COMMIT 3
t "over budget (10 of 10 merged this cycle)"            1 "$(c agent:tpr-reviewer approve $AFTER)" $COMMIT 10
t "verdict reject"                                      1 "$(c agent:tpr-reviewer reject $AFTER)" $COMMIT 3
t "no quorum comment"                                   1 '[{"body":"lgtm","created_at":"2026-10-12T11:00:00Z"}]' $COMMIT 3
t "no quorum comment"                                   1 "$(c agent:tpr-reviewer approve $AFTER | jq '.[0].author_association="NONE"')" $COMMIT 3   # stranger's comment ignored
t n/a                                                   0 '[]' $COMMIT 99   # non-group PR: neither quorum nor budget applies

# cycle boundary: 11:30 UTC
eq() { [ "$2" = "$3" ] && echo "ok   $1" || { echo "FAIL $1: want '$3' got '$2'"; FAIL=1; }; }
eq "cycle start before close" "$(wg_cycle_start 2026-10-09T10:00:00Z)" 2026-10-08T11:30:00Z
eq "cycle start after close"  "$(wg_cycle_start 2026-10-09T12:00:00Z)" 2026-10-09T11:30:00Z
eq "cycle start at close"     "$(wg_cycle_start 2026-10-09T11:30:00Z)" 2026-10-09T11:30:00Z
# owner-merge PRs are not counted
case $(wg_budget_query 2026-10-09T11:30:00Z) in *'-label:"gate:owner-merge"'*'merged:>=2026-10-09T11:30:00Z') echo "ok   budget query excludes owner-merge" ;; *) echo "FAIL budget query"; FAIL=1 ;; esac

# pause: reports are owner comments with the marker; ack = +1 from the-greenman
rep() { jq -n --argjson ids "$1" '[$ids[]|{id:.,body:"<!-- wg-report cycle=2026-10-0\(.) -->\nreport",created_at:"2026-10-0\(.)T11:30:00Z",author_association:"OWNER"}]'; }
ACKED=; wg_reactions() { case " $ACKED " in *" $1 "*) echo '[{"content":"+1","user":{"login":"the-greenman"}}]' ;; *) echo '[{"content":"+1","user":{"login":"stranger"}},{"content":"heart","user":{"login":"the-greenman"}}]' ;; esac; }
eq "paused with 2 unacked reports" "$(wg_paused "$(rep '[7,8]')")" "paused: 2 reports unacknowledged"
ACKED=7; eq "not paused when one is acked" "$(wg_paused "$(rep '[7,8]')")" ok
ACKED=; eq "not paused with fewer than 2 reports" "$(wg_paused "$(rep '[8]')")" ok
eq "stranger's report ignored" "$(wg_paused "$(rep '[7,8]' | jq '.[]|=(.author_association="NONE")')")" ok
wg_reactions() { return 1; }; eq "fail closed on unreadable reactions" "$(wg_paused "$(rep '[7,8]')")" "paused: reactions unreadable"
exit $FAIL
