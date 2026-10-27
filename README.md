# sowork-presence-watch

Watch your [SoWork](https://www.sowork.com/) office from the terminal, and get
an alert when a teammate's presence changes.

```
SoWork office my-profile  every 30s · next check in 25s · last 20:26:19
9 teammates · 2 alerts on · alert: say "My custom alert: $SOWORK_PRESENCE_WATCH_MESSAGE"

●    Jordan 🚀                      available
●    Robin                          available
●    Sam                            available (you)
●    Priya                          busy       🎧 Focus time
● 🔔 Taylor                         busy       In a meeting until 15:00
◐ 🔔 Alex                           away       Lunch 🍜
◐    Kai                            away
○    Chris                          offline    On vacation 🌴
○    Morgan                         offline

20:26:19 Saved alerts on for Alex
20:26:22 Alert on for Taylor (busy)
↑↓ select · space alert on/off · t test alert · a alert command · +/- interval · r check now · p profiles · q quit
```

Mark a teammate with an alert (🔔). When their availability changes — for
example from `away` to `available` — you get a notification. Your alerts and
your alert command are saved for the next start, but alerts only fire while
the tool runs: quit, and nothing keeps running in the background.

This is an independent tool built on the public `sowork` SDK. It is not an
official SoWork product.

## Requirements

- Node.js 22.18 or later
- A SoWork API key. In SoWork, open the office you want to watch and go to
  Settings → SoWork API → API keys. A key belongs to one office.

## Platforms

- **macOS**: everything works. The default alert is a desktop notification.
- **Linux**: everything works, but the default alert is only a terminal bell.
  For a desktop notification, set a custom alert such as
  `notify-send "$SOWORK_PRESENCE_WATCH_MESSAGE"` (see
  [Custom alerts](#custom-alerts)).
- **Windows**: not tested. Custom alerts run in `sh -c`, so they need WSL or
  Git Bash.

## Install

```sh
git clone https://github.com/maximetinu/sowork-presence-watch.git
cd sowork-presence-watch
npm install
npm link        # puts `sowork-presence-watch` on your PATH
```

## Profiles

A profile is one API key, so one office, with its own alerts. When you start
the tool, it shows your profiles:

```
sowork-presence-watch

Choose a profile. Each profile is one SoWork API key, so one office, with its own alerts.

  my-other-office      Sam · 0 alerts
▸ my-profile           Sam · 2 alerts
  + New profile

↑↓ select · enter open · n new profile · r rename · d delete · q quit
```

Pick one with `enter`, or create one: type a name, then paste the API key. The
tool checks the key before it saves the profile. If you used `sowork login`,
leave the key empty to use that key. In the office view, `p` goes back to the
profiles, so you can switch offices without quitting.

Flags skip the picker:

```sh
sowork-presence-watch --profile my-profile                  # open a saved profile
sowork-presence-watch --profile my-profile --api-key sw_…   # create it, or replace its key
SOWORK_API_KEY=sw_… sowork-presence-watch             # one run without a profile (alerts not saved)
```

`--base-url` and `SOWORK_BASE_URL` (or `base-url` in the `sowork` CLI config)
select another API environment for all profiles.

## Use

```sh
sowork-presence-watch                      # pick a profile, then open the office view
sowork-presence-watch --watch Alex         # also turn on an alert for Alex
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
| `p` | Back to the profiles |
| `q` or `Ctrl+C` | Quit |

## Saved settings

The tool saves its settings in `~/.config/sowork-presence-watch/config.json`,
or under `$SOWORK_PRESENCE_WATCH_CONFIG_DIR` / `$XDG_CONFIG_HOME` when set:
each profile's API key and its teammates with an alert (by user id), the last
profile opened, and the alert command, which all profiles share.

The file holds your API keys in plain text, readable only by your user
(mode `0600`), like the `sowork` CLI's own config. Delete the file to start
clean.

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

# Desktop notification (Linux)
sowork-presence-watch --alert-command 'notify-send "SoWork" "$SOWORK_PRESENCE_WATCH_MESSAGE"'

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
