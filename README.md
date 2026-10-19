# Side Panel

A clock for the Cinnamon panel that opens a side panel of widgets. Think of
it as a notification centre and dashboard for Linux Mint.

![The side panel open on the desktop](docs/desktop.jpg)

<p align="center">
  <img src="docs/panel-bottom.png" alt="The side panel scrolled down: Ambient Sounds presets and sleep timer, and app volume" width="300">
  <br><em>Scrolled down: Ambient Sounds presets and sleep timer, and app volume.</em>
</p>

**Status:** all four planned phases are done: the panel, calendar and media
widgets, notifications with Do Not Disturb, weather, and customising which
widgets show and in what order.

## Widgets

| Widget | What it does |
| --- | --- |
| Date and time | The time and today's date, large. |
| Calendar | Month view; arrows or scrolling change month, clicking the month name returns to today. Styled by your theme's calendar rules. |
| Weather | Current conditions and a five-day forecast from [Open-Meteo](https://open-meteo.com) (free, no account). Search for your city in the widget; °C/°F toggle. Only the city name you search for and its coordinates are sent. The last forecast is kept, so it shows offline. |
| Notifications | Notification history, newest first: app, time, title, body and the notification's own action buttons. Click one to open it, × to dismiss, or clear all. Critical notifications are tinted. Includes a **Do not disturb** switch (see below). |
| Now playing | Every media player (MPRIS): cover art, title, artist, and previous / play-pause / next. Click a player to bring its window forward. |
| App volume | A volume slider and mute button for each app playing sound. |
| Ambient Sounds | Shipped by the [Ambient Sounds](https://github.com/PhillipMwaniki/ambient-sounds) applet when it's installed: sound tiles, levels, presets and a sleep timer. |

## Customising

Click the pencil in the panel's footer to customise. Each widget gets
buttons to move it up or down or hide it, and hidden widgets are listed at
the bottom with an **Add** button. Click the tick, or close the panel, when
you're done. Changes apply straight away without reloading the other
widgets.

## Do not disturb

Cinnamon's own "display notifications" switch throws notifications away
while it's off. While Side Panel is installed, turning it off (from the
widget or System Settings; they're the same switch) hides banners but still
collects every notification in the panel. Remove the applet and Cinnamon's
original behaviour comes back.

Notifications are shared with the stock Notifications applet if you also
have that on a panel: dismissing one in either place removes it from both.

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

## Writing widgets

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
