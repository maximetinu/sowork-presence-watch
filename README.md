# sowork-presence-watch

Watch your [SoWork](https://www.sowork.com/) office from the terminal, and get
an alert when a teammate's presence changes.

```
SoWork office  every 30s · next check in 12s · last 14:33:49
22 teammates · 1 alert on · alert: desktop notification

●    Alice                          available
●    Sam                            available (you)
●    Bob 😎                          busy
◐ 🔔 Alex                           away
○    Dana                           offline

14:33:49 Alert on for Alex (away)
↑↓ select · space alert on/off · t test alert · a alert command · +/- interval · r check now · q quit
```

Mark a teammate with an alert (🔔). When their availability changes — for
example from `away` to `available` — you get a notification. Your alerts and
your alert command are saved for the next start, but alerts only fire while
the tool runs: quit, and nothing keeps running in the background.

This is an independent tool built on the public `sowork` SDK. It is not an
official SoWork product.

## Requirements

- Node.js 22.18 or later
- A SoWork API key. Create one in SoWork settings.

## Install

```sh
git clone https://github.com/maximetinu/sowork-presence-watch.git
cd sowork-presence-watch
npm install
npm link        # puts `sowork-presence-watch` on your PATH
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
sowork-presence-watch                      # open the office view
sowork-presence-watch --watch Alex         # start with an alert on Alex
sowork-presence-watch --interval 60        # check every 60 seconds
```

`--watch` takes a user id or part of a name, and you can repeat it. A name
part that matches several teammates puts an alert on each of them. Like the
`space` key, it saves the alert for the next start.

| Key | Action |
| --- | --- |
| `↑` `↓` or `k` `j` | Select a teammate |
| `space` or `enter` | Turn the alert on or off for the selected teammate (saved) |
| `t` | Test the alert: run it once with a made-up change of the selected teammate |
| `a` | Edit the alert command. It is saved and used on the next start |
| `+` `-` | Change the check interval by 10 seconds (10 s minimum) |
| `r` | Check now |
| `q` or `Ctrl+C` | Quit |

## Saved settings

The tool saves the teammates with an alert (by user id) and the alert command in
`~/.config/sowork-presence-watch/config.json`, or under
`$SOWORK_PRESENCE_WATCH_CONFIG_DIR` / `$XDG_CONFIG_HOME` when set. Delete the
file to start clean.

## Custom alerts

By default an alert is a desktop notification on macOS, and a terminal bell on
other systems. To run your own command instead, press `a` in the tool, type the
command and press `enter`. Press `t` to try it. The command is saved (see
above). Save it empty to go back to the default alert.

You can also pass `--alert-command` or set `SOWORK_PRESENCE_WATCH_ALERT_COMMAND`.
These win over the saved command for that run.

The command runs in `sh -c` and gets these environment variables:

| Variable | Example |
| --- | --- |
| `SOWORK_PRESENCE_WATCH_USER_ID` | `u1a2b3c4d5e6f7g8h9i0` |
| `SOWORK_PRESENCE_WATCH_NAME` | `Alex` |
| `SOWORK_PRESENCE_WATCH_FROM` | `away` |
| `SOWORK_PRESENCE_WATCH_TO` | `available` |
| `SOWORK_PRESENCE_WATCH_MESSAGE` | `Alex is now available (was away)` |

The values are passed as variables, never pasted into the command text, so
names with quotes are safe. Quote the variables in your command.

```sh
# Speak the change (macOS)
sowork-presence-watch --alert-command 'say "$SOWORK_PRESENCE_WATCH_MESSAGE"'

# Only when someone becomes available
sowork-presence-watch --alert-command '[ "$SOWORK_PRESENCE_WATCH_TO" = available ] && say "$SOWORK_PRESENCE_WATCH_NAME is back"'
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
