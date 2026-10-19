// Volume and mute for each app playing sound, through the same Cvc mixer
// library as the stock sound applet. Streams from one app share a row: an
// app like Ambient Sounds opens a stream per sound.

const Clutter = imports.gi.Clutter;
const Cvc = imports.gi.Cvc;
const St = imports.gi.St;
const Slider = imports.ui.slider;

const MUTE_THRESHOLD = 0.005;   // slider values below this mute the app

function appKey(stream) {
    return stream.application_id || stream.name || String(stream.id);
}

function capitalize(text) {
    return text ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}

class AppRow {
    constructor(stream, norm) {
        this._norm = norm;
        this._streams = new Map();   // stream id -> { stream, ids: [signal ids] }
        this._dragging = false;

        this.actor = new St.BoxLayout({ style_class: 'sidepanel-app-volume-row' });
        this._icon = new St.Icon({ icon_name: stream.icon_name || 'audio-x-generic', icon_size: 24, y_align: Clutter.ActorAlign.CENTER });
        const column = new St.BoxLayout({ vertical: true, x_expand: true, y_align: Clutter.ActorAlign.CENTER });
        this._name = new St.Label({ text: capitalize(stream.name) || _('Unknown app'), style_class: 'sidepanel-app-volume-name' });
        this._slider = new Slider.Slider(0);
        this._slider.actor.x_expand = true;
        this._slider.connect('value-changed', (slider, value) => this._setVolume(value));
        this._slider.connect('drag-begin', () => { this._dragging = true; });
        this._slider.connect('drag-end', () => { this._dragging = false; this._sync(); });
        column.add_child(this._name);
        column.add_child(this._slider.actor);

        this._mute = new St.Button({ style_class: 'sidepanel-media-button', can_focus: true, y_align: Clutter.ActorAlign.CENTER });
        this._muteIcon = new St.Icon({ icon_type: St.IconType.SYMBOLIC, icon_size: 16 });
        this._mute.set_child(this._muteIcon);
        this._mute.connect('clicked', () => this._toggleMute());

        this.actor.add_child(this._icon);
        this.actor.add_child(column);
        this.actor.add_child(this._mute);

        this.addStream(stream);
    }

    get empty() {
        return this._streams.size === 0;
    }

    addStream(stream) {
        if (this._streams.has(stream.id))
            return;
        const ids = [
            stream.connect('notify::volume', () => this._sync()),
            stream.connect('notify::is-muted', () => this._sync()),
        ];
        this._streams.set(stream.id, { stream, ids });
        this._sync();
    }

    removeStream(id) {
        const entry = this._streams.get(id);
        if (!entry)
            return;
        entry.ids.forEach(signalId => entry.stream.disconnect(signalId));
        this._streams.delete(id);
        this._sync();
    }

    destroy() {
        for (const id of [...this._streams.keys()])
            this.removeStream(id);
        this.actor.destroy();
    }

    _all() {
        return [...this._streams.values()].map(entry => entry.stream);
    }

    _muted() {
        return this._all().every(stream => stream.is_muted);
    }

    _sync() {
        const streams = this._all();
        if (!streams.length)
            return;
        const muted = this._muted();
        const level = Math.max(...streams.map(stream => stream.volume)) / this._norm;
        if (!this._dragging)
            this._slider.setValue(muted ? 0 : level);

        let icon = 'audio-volume-high-symbolic';
        if (muted || level === 0)
            icon = 'audio-volume-muted-symbolic';
        else if (level < 0.34)
            icon = 'audio-volume-low-symbolic';
        else if (level < 0.67)
            icon = 'audio-volume-medium-symbolic';
        this._muteIcon.icon_name = icon;
        this._mute.accessible_name = muted ? _('Unmute') : _('Mute');
    }

    _setVolume(value) {
        const muted = value < MUTE_THRESHOLD;
        for (const stream of this._all()) {
            stream.volume = muted ? 0 : value * this._norm;
            stream.push_volume();
            if (stream.is_muted !== muted)
                stream.change_is_muted(muted);
        }
    }

    _toggleMute() {
        const mute = !this._muted();
        for (const stream of this._all())
            stream.change_is_muted(mute);
    }
}

var Widget = class Widget {
    constructor(ctx) {
        this._rows = new Map();      // app key -> AppRow
        this._streamApp = new Map(); // stream id -> app key

        this.actor = new St.BoxLayout({ vertical: true, style_class: 'sidepanel-app-volume' });
        this._empty = new St.Label({ text: _('No apps are playing sound'), style_class: 'sidepanel-empty' });
        this.actor.add_child(this._empty);

        this._control = new Cvc.MixerControl({ name: 'Side Panel' });
        this._signals = [
            this._control.connect('state-changed', () => this._onStateChanged()),
            this._control.connect('stream-added', (control, id) => this._onStreamAdded(id)),
            this._control.connect('stream-removed', (control, id) => this._onStreamRemoved(id)),
        ];
        this._control.open();
    }

    destroy() {
        this._signals.forEach(id => this._control.disconnect(id));
        for (const row of this._rows.values())
            row.destroy();
        this._rows.clear();
        this._control.close();
    }

    _onStateChanged() {
        if (this._control.get_state() !== Cvc.MixerControlState.READY)
            return;
        for (const stream of this._control.get_sink_inputs())
            this._onStreamAdded(stream.id);
    }

    _onStreamAdded(id) {
        const stream = this._control.lookup_stream_id(id);
        // Skip virtual streams and event sounds, as the stock applet does.
        if (!(stream instanceof Cvc.MixerSinkInput) || stream.is_virtual || stream.application_id === 'org.freedesktop.libcanberra')
            return;
        if (this._streamApp.has(id))
            return;

        const key = appKey(stream);
        this._streamApp.set(id, key);
        const row = this._rows.get(key);
        if (row) {
            row.addStream(stream);
        } else {
            const newRow = new AppRow(stream, this._control.get_vol_max_norm());
            this._rows.set(key, newRow);
            this.actor.add_child(newRow.actor);
        }
        this._empty.visible = false;
    }

    _onStreamRemoved(id) {
        const key = this._streamApp.get(id);
        if (key === undefined)
            return;
        this._streamApp.delete(id);
        const row = this._rows.get(key);
        row.removeStream(id);
        if (row.empty) {
            row.destroy();
            this._rows.delete(key);
        }
        this._empty.visible = this._rows.size === 0;
    }
};
