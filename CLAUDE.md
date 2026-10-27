# CLAUDE.md

## Keep the README screens in step with the UI

`README.md` shows what the tool looks like: the office view at the top and the
profile picker under "Profiles". When you change what a screen shows (header,
list columns, log lines, key hints), update these examples in the same commit.

- Copy the screen from a real render, not by hand: run `OfficeView` or
  `ProfilePicker` in a pseudo-terminal with made-up data and `NO_COLOR=1`,
  then paste the text. Hand-typed rows get the emoji spacing wrong.
- Use only made-up data that reads as an example: names like Alex or Priya, a
  profile like `my-profile`, an alert command like
  `say "My custom alert: $SOWORK_PRESENCE_WATCH_MESSAGE"`. Never use real
  teammates, offices, user ids or API keys.
