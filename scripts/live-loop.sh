#!/usr/bin/env bash
# Bucla live: rulează câte un ciclu (node src/cron.js) la fiecare 5 minute, până aproape de limita de 6 ore a unui
# job GitHub, salvând starea după fiecare ciclu. La final, workflow-ul se repornește singur.
# Înainte de fiecare ciclu aduce ultimele modificări (config, rezultatele școlii lunare, cod nou).
set -u
INTERVAL=${LOOP_INTERVAL:-300}
END=$(( $(date +%s) + ${LOOP_SECONDS:-20400} ))   # ~5h40m
git config user.name "apex-bot"
git config user.email "apex-bot@users.noreply.github.com"
n=0
while [ "$(date +%s)" -lt "$END" ]; do
  t0=$(date +%s)
  n=$((n + 1))
  git pull -q --rebase --autostash origin main || echo "::warning::git pull a eșuat la ciclul $n"
  if ! timeout 240 node src/cron.js; then echo "::warning::ciclul $n a eșuat (continuăm)"; fi
  git add state/live_state.json
  if ! git diff --cached --quiet; then
    git commit -q -m "stare live $(date -u +%Y-%m-%dT%H:%MZ)"
    for i in 1 2 3 4 5; do git pull -q --rebase origin main && git push -q origin main && break; sleep $((RANDOM % 10 + 3)); done
  fi
  left=$(( INTERVAL - ($(date +%s) - t0) ))
  [ "$left" -gt 0 ] && sleep "$left"
done
echo "Bucla s-a încheiat după $n cicluri."
