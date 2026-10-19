# Side Panel

A clock for the Cinnamon panel that opens a side panel of widgets. Think of
it as a notification centre and dashboard for Linux Mint.

**Status: phase 1.** The panel shell and the widget system work. The only
built-in widget so far is the date header. Coming next: a calendar, Ambient
Sounds, now-playing and per-app audio, then notifications and weather.

## Using it

- Click the clock, or press **Super+N**, to open the panel. Click anywhere
  outside it, press **Escape**, or press the shortcut again to close it.
- The panel opens on the same side of the screen as the clock. You can pin
  it to the left or right, and change its width, in the applet's settings.
- The clock follows your system 12/24-hour setting, or takes a custom
  strftime format.

## Install

```sh
ln -s "$PWD/sidepanel@PhillipMwaniki" ~/.local/share/cinnamon/applets/
```

Then add **Side Panel** from *System Settings → Applets*. You'll probably
want to remove the stock Calendar applet, since this one replaces it.

## Widgets

Widgets are self-contained folders with a `widget.json` and a `widget.js`.
Other applets can ship one in a `sidepanel-widget/` folder, so they work on
their own and also appear in the panel when it's installed.

See [docs/WIDGETS.md](docs/WIDGETS.md) for the contract.

## Development

Reload after editing:

```sh
gdbus call --session --dest org.Cinnamon --object-path /org/Cinnamon \
  --method org.Cinnamon.Eval \
  "imports.ui.extension.reloadExtension('sidepanel@PhillipMwaniki', imports.ui.extension.Type.APPLET)"
```

Modules are loaded with `require()`, which picks up changes on reload.

## Licence

[MIT](LICENSE)
