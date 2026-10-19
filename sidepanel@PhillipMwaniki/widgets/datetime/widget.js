// Built-in header widget: the time and today's date in large type. Also the
// smallest example of the widget contract (see docs/WIDGETS.md).

const CinnamonDesktop = imports.gi.CinnamonDesktop;
const Gio = imports.gi.Gio;
const St = imports.gi.St;

const DATE_FORMAT = CinnamonDesktop.WallClock.lctime_format('cinnamon', _('%A, %B %-e'));

var Widget = class Widget {
    constructor(ctx) {
        this.actor = new St.BoxLayout({ vertical: true, style_class: 'sidepanel-datetime' });
        this._time = new St.Label({ style_class: 'sidepanel-datetime-time' });
        this._date = new St.Label({ style_class: 'sidepanel-datetime-date' });
        this.actor.add_child(this._time);
        this.actor.add_child(this._date);

        this._desktopSettings = new Gio.Settings({ schema_id: 'org.cinnamon.desktop.interface' });
        this._settingsId = this._desktopSettings.connect('changed::clock-use-24h', () => this._update());
        this._clock = new CinnamonDesktop.WallClock();
        this._clockId = this._clock.connect('notify::clock', () => this._update());
        this._update();
    }

    onShown() {
        this._update();
    }

    destroy() {
        this._clock.disconnect(this._clockId);
        this._desktopSettings.disconnect(this._settingsId);
    }

    _update() {
        const timeFormat = this._desktopSettings.get_boolean('clock-use-24h') ? '%H:%M' : '%l:%M %p';
        this._time.text = this._clock.get_clock_for_format(timeFormat).trim();
        this._date.text = this._clock.get_clock_for_format(DATE_FORMAT);
    }
};
