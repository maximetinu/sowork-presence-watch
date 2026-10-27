# presence-watch

Watch your [SoWork](https://www.sowork.com/) office from the terminal, and get
an alert when a teammate's presence changes.

```
SoWork office  every 30s · next check in 12s · last 14:33:49
22 teammates · 1 alert on

●    Alice                          available
●    Sam                            available (you)
●    Bob 😎                          busy
◐ 🔔 Alex                           away
○    Dana                           offline

14:33:49 Alert on for Alex (away)
↑↓ select · space alert on/off · +/- interval · r check now · q quit
```

Mark a teammate with an alert (🔔). When their availability changes — for
example from `away` to `available` — you get a notification. Alerts live only
while the process runs: quit, and nothing keeps running in the background.

This is an independent tool built on the public `sowork` SDK. It is not an
official SoWork product.

## Requirements

- Node.js 22.18 or later
- A SoWork API key. Create one in SoWork settings.

## Install

```sh
git clone https://github.com/maximetinu/presence-watch.git
cd presence-watch
npm install
npm link        # puts `presence-watch` on your PATH
```

## Authenticate

The tool looks for an API key in this order:

1. the `--api-key` flag
2. the `SOWORK_API_KEY` environment variable
3. the key that the `sowork` CLI saved with `sowork login`
   (`~/.config/sowork/config.json`; it honors `SOWORK_CONFIG_DIR` and
   `XDG_CONFIG_HOME`)

`--base-url` and `SOWORK_BASE_URL` select another API environment.

## Use

```sh
presence-watch                      # open the office view
presence-watch --watch Alex         # start with an alert on Alex
presence-watch --interval 60        # check every 60 seconds
```

`--watch` takes a user id or part of a name, and you can repeat it. A name
part that matches several teammates puts an alert on each of them.

| Key | Action |
| --- | --- |
| `↑` `↓` or `k` `j` | Select a teammate |
| `space` or `enter` | Turn the alert on or off for the selected teammate |
| `+` `-` | Change the check interval by 10 seconds (10 s minimum) |
| `r` | Check now |
| `q` or `Ctrl+C` | Quit |

## Custom alerts

By default an alert is a desktop notification on macOS, and a terminal bell on
other systems. To run your own command instead, pass `--alert-command` or set
`PRESENCE_WATCH_ALERT_COMMAND`. The command runs in `sh -c` and gets these
environment variables:

| Variable | Example |
| --- | --- |
| `PRESENCE_WATCH_USER_ID` | `u1a2b3c4d5e6f7g8h9i0` |
| `PRESENCE_WATCH_NAME` | `Alex` |
| `PRESENCE_WATCH_FROM` | `away` |
| `PRESENCE_WATCH_TO` | `available` |
| `PRESENCE_WATCH_MESSAGE` | `Alex is now available (was away)` |

The values are passed as variables, never pasted into the command text, so
names with quotes are safe. Quote the variables in your command.

```sh
# Speak the change (macOS)
presence-watch --alert-command 'say "$PRESENCE_WATCH_MESSAGE"'

# Only when someone becomes available
presence-watch --alert-command '[ "$PRESENCE_WATCH_TO" = available ] && say "$PRESENCE_WATCH_NAME is back"'
```

## How it works

Every interval, the tool calls `GET /v1/users` (`client.users.listUsers()` in
the SDK) and compares each watched teammate's availability with the previous
check. One request per interval, whatever the number of alerts. A failed check
shows an error line and the next check tries again.

The public API also has an `office.member_presence_updated` event, which would
remove the polling, but only office admins can subscribe to it. Polling works
for every member.

## Development

```sh
npm start -- --watch Alex   # run from source (Node strips the types)
npm test
npm run typecheck
npm run build               # compile to dist/
```

## License

MIT
