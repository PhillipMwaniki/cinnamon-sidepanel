# Writing a Side Panel widget

A widget is a folder with two files:

```
my-widget/
├── widget.json
└── widget.js
```

## Where widgets live

The panel looks in three places, and the first widget found with a given
`id` wins:

1. **Built-in**: `sidepanel@PhillipMwaniki/widgets/<name>/`
2. **Shipped by another applet**: `<applet folder>/sidepanel-widget/`, in
   `~/.local/share/cinnamon/applets/` and then `/usr/share/cinnamon/applets/`.
   An applet such as Ambient Sounds can offer a widget this way and still work
   on its own when the side panel isn't installed.
3. **Extra folders** listed in the `extra-widget-dirs` setting, which is
   handy while developing a widget.

## widget.json

```json
{
    "id": "my-widget",
    "name": "My widget",
    "description": "One line about what it shows.",
    "api": 1,
    "main": "widget.js",
    "card": true,
    "showTitle": true,
    "order": 50
}
```

| Key | Required | Meaning |
| --- | --- | --- |
| `id` | yes | Unique id. Also the key for the widget's settings and its place in the order. |
| `name` | yes | Shown as the card title and in error messages. |
| `description` | no | For the future widget picker. |
| `api` | no | Widget API version the widget needs (default 1). A panel with an older API shows an error card instead of loading it. |
| `main` | no | Entry file (default `widget.js`). |
| `card` | no | `false` draws the widget straight onto the panel with no card around it, as the date header does. |
| `showTitle` | no | `false` hides the card title. |
| `order` | no | Default position (lower is higher up; default 50). The date header is 0 and the calendar 10. Positions the user sets win. |

## widget.js

The entry file defines a `Widget` class:

```js
const St = imports.gi.St;

var Widget = class Widget {
    constructor(ctx) {
        this.actor = new St.Label({ text: 'Hello' });
    }

    // Optional hooks
    onShown() {}     // the panel finished opening
    onHidden() {}    // the panel closed

    destroy() {}     // disconnect signals, stop timers, free resources
};
```

- `actor` must be set by the end of the constructor. The panel puts it inside
  the widget's card.
- `destroy()` is called when the panel reloads widgets or the applet is
  removed. Leaving signal handlers or timers behind keeps running code inside
  Cinnamon, so clean up everything here.
- Use `onShown`/`onHidden` to pause work nobody can see, such as polling.
- Files are loaded with Cinnamon's `require()`, relative to the widget's own
  folder: `const { thing } = require('./thing');`. Top-level `var`, `const`,
  `function` and `class` declarations are exported automatically.
- An exception thrown by the constructor or a hook is caught and logged. A
  failed constructor shows an error card in place of the widget, and the rest
  of the panel carries on.

## The context object

The constructor receives `ctx`:

| Member | Meaning |
| --- | --- |
| `ctx.id` | The widget's id. |
| `ctx.dir` | Absolute path of the widget folder, e.g. for loading images. |
| `ctx.meta` | The parsed `widget.json`. |
| `ctx.apiVersion` | The API version the panel provides. |
| `ctx.settings.get(key, fallback)` | Read a saved value. |
| `ctx.settings.set(key, value)` | Save a JSON-serialisable value. Stored per widget in the panel's settings. |
| `ctx.closePanel()` | Close the panel, e.g. after launching an app. |

## Developing

Point `extra-widget-dirs` at your folder from Looking Glass (Super+L) or a
D-Bus Eval, then reload:

```js
const a = imports.ui.appletManager.getRunningInstancesForUuid('sidepanel@PhillipMwaniki')[0];
a.settings.setValue('extra-widget-dirs', ['/path/to/my-widget']);
a.widgets.reload();
```

Errors are logged to `~/.xsession-errors` with a `sidepanel:` prefix.
