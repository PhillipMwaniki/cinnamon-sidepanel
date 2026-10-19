// Media players (MPRIS) with track info and playback controls, using the
// same D-Bus proxies as the stock sound applet.

const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const St = imports.gi.St;
const Clutter = imports.gi.Clutter;
const Interfaces = imports.misc.interfaces;

const MPRIS_PREFIX = 'org.mpris.MediaPlayer2.';
const ART_SIZE = 48;

function unpackString(variant) {
    if (!variant)
        return '';
    // xesam:artist is a list of strings, xesam:title a plain string.
    const value = variant.deep_unpack();
    return Array.isArray(value) ? value.join(', ') : String(value);
}

function controlButton(iconName, label, callback) {
    const button = new St.Button({ style_class: 'sidepanel-media-button', can_focus: true, accessible_name: label });
    button.set_child(new St.Icon({ icon_name: iconName, icon_type: St.IconType.SYMBOLIC, icon_size: 16 }));
    button.connect('clicked', callback);
    return button;
}

class Player {
    constructor(busName, owner, pid, onChanged, closePanel) {
        this.busName = busName;
        this.owner = owner;
        this.pid = pid;
        this._onChanged = onChanged;
        this._closePanel = closePanel;
        this._destroyed = false;
        this._artUrl = null;

        this.actor = new St.BoxLayout({ vertical: true, style_class: 'sidepanel-media-player', visible: false });

        // Clicking the art or the text brings the player's window forward.
        const info = new St.Button({ style_class: 'sidepanel-media-info', x_expand: true, can_focus: true });
        const infoBox = new St.BoxLayout({ style_class: 'sidepanel-media-info-box' });
        this._art = new St.Icon({ icon_size: ART_SIZE, style_class: 'sidepanel-media-art' });
        const text = new St.BoxLayout({ vertical: true, y_align: Clutter.ActorAlign.CENTER, x_expand: true });
        this._title = new St.Label({ style_class: 'sidepanel-media-title' });
        this._artist = new St.Label({ style_class: 'sidepanel-media-artist' });
        this._app = new St.Label({ style_class: 'sidepanel-media-app' });
        text.add_child(this._title);
        text.add_child(this._artist);
        text.add_child(this._app);
        infoBox.add_child(this._art);
        infoBox.add_child(text);
        info.set_child(infoBox);
        info.connect('clicked', () => this._raise());
        this.actor.add_child(info);

        const controls = new St.BoxLayout({ style_class: 'sidepanel-media-controls', x_align: Clutter.ActorAlign.CENTER });
        this._prev = controlButton('media-skip-backward-symbolic', _('Previous'), () => this._player.PreviousRemote());
        this._playPause = controlButton('media-playback-start-symbolic', _('Play'), () => this._player.PlayPauseRemote());
        this._next = controlButton('media-skip-forward-symbolic', _('Next'), () => this._player.NextRemote());
        controls.add_child(this._prev);
        controls.add_child(this._playPause);
        controls.add_child(this._next);
        this.actor.add_child(controls);

        Interfaces.getDBusProxyWithOwnerAsync('org.mpris.MediaPlayer2', owner, (proxy, error) => {
            if (error || this._destroyed)
                return;
            this._server = proxy;
            this._update();
        });
        Interfaces.getDBusProxyWithOwnerAsync('org.mpris.MediaPlayer2.Player', owner, (proxy, error) => {
            if (error || this._destroyed)
                return;
            this._player = proxy;
            this._propsId = proxy.connect('g-properties-changed', () => this._update());
            this._update();
        });
    }

    get playing() {
        return this._player ? this._player.PlaybackStatus === 'Playing' : false;
    }

    destroy() {
        this._destroyed = true;
        if (this._player && this._propsId)
            this._player.disconnect(this._propsId);
        this.actor.destroy();
    }

    // Untagged files: show the file name rather than nothing.
    _fileName(urlVariant) {
        const url = unpackString(urlVariant);
        if (!url)
            return '';
        const file = Gio.File.new_for_uri(url);
        return decodeURIComponent(file.get_basename() || '');
    }

    _appName() {
        if (this._server && this._server.Identity)
            return this._server.Identity;
        const name = this.busName.slice(MPRIS_PREFIX.length).split('.')[0];
        return name.charAt(0).toUpperCase() + name.slice(1);
    }

    _appIcon() {
        const entry = this._server && this._server.DesktopEntry;
        const info = entry ? Gio.DesktopAppInfo.new(`${entry}.desktop`) : null;
        return (info && info.get_icon()) || new Gio.ThemedIcon({ name: 'audio-x-generic' });
    }

    _update() {
        if (!this._player)
            return;
        const metadata = this._player.Metadata || {};
        const title = unpackString(metadata['xesam:title']) || this._fileName(metadata['xesam:url']);
        const artist = unpackString(metadata['xesam:artist']);

        // A player that is open but has nothing loaded isn't worth a card.
        this.actor.visible = Boolean(title) || this.playing;
        this._title.text = title || _('Unknown title');
        this._artist.text = artist;
        this._artist.visible = Boolean(artist);
        this._app.text = this._appName();

        this._playPause.child.icon_name = this.playing ? 'media-playback-pause-symbolic' : 'media-playback-start-symbolic';
        this._playPause.accessible_name = this.playing ? _('Pause') : _('Play');
        this._prev.reactive = this._player.CanGoPrevious !== false;
        this._next.reactive = this._player.CanGoNext !== false;
        this._prev.opacity = this._prev.reactive ? 255 : 100;
        this._next.opacity = this._next.reactive ? 255 : 100;

        this._updateArt(metadata['mpris:artUrl'] ? metadata['mpris:artUrl'].deep_unpack() : null);
        this._onChanged();
    }

    // file:// and http(s):// art load through GIO; anything else (data:
    // URIs, missing art) falls back to the app's icon.
    _updateArt(url) {
        if (url === this._artUrl && this._art.gicon)
            return;
        this._artUrl = url;
        if (url && /^(file|https?):\/\//.test(url))
            this._art.gicon = new Gio.FileIcon({ file: Gio.File.new_for_uri(url) });
        else
            this._art.gicon = this._appIcon();
    }

    _raise() {
        if (this._server && this._server.CanRaise) {
            this._server.RaiseRemote();
            this._closePanel();
        }
    }
}

var Widget = class Widget {
    constructor(ctx) {
        this._ctx = ctx;
        this._players = new Map();   // bus name -> Player

        this.actor = new St.BoxLayout({ vertical: true, style_class: 'sidepanel-media' });
        this._empty = new St.Label({ text: _('Nothing playing'), style_class: 'sidepanel-empty' });
        this.actor.add_child(this._empty);

        Interfaces.getDBusAsync((proxy, error) => {
            if (error || this._destroyed)
                return;
            this._dbus = proxy;
            this._ownerChangedId = proxy.connectSignal('NameOwnerChanged', (proxy, sender, [name, oldOwner, newOwner]) => {
                if (!name.startsWith(MPRIS_PREFIX))
                    return;
                this._removePlayer(name);
                if (newOwner)
                    this._addPlayer(name, newOwner);
            });
            proxy.ListNamesRemote(([names]) => {
                for (const name of names || []) {
                    if (name.startsWith(MPRIS_PREFIX))
                        proxy.GetNameOwnerRemote(name, ([owner]) => this._addPlayer(name, owner));
                }
            });
        });
    }

    destroy() {
        this._destroyed = true;
        if (this._dbus && this._ownerChangedId)
            this._dbus.disconnectSignal(this._ownerChangedId);
        for (const player of this._players.values())
            player.destroy();
        this._players.clear();
    }

    // Some players (VLC) register two MPRIS names from two connections, so
    // keep one card per process.
    _addPlayer(name, owner) {
        if (this._destroyed || this._players.has(name))
            return;
        Gio.DBus.session.call('org.freedesktop.DBus', '/org/freedesktop/DBus', 'org.freedesktop.DBus',
            'GetConnectionUnixProcessID', new GLib.Variant('(s)', [owner]), null, Gio.DBusCallFlags.NONE, -1, null,
            (connection, result) => {
                let pid = 0;
                try {
                    [pid] = connection.call_finish(result).deep_unpack();
                } catch (e) {
                    // Unknown pid: show the player rather than risk hiding it.
                }
                if (this._destroyed || this._players.has(name))
                    return;
                if (pid && [...this._players.values()].some(player => player.pid === pid))
                    return;
                const player = new Player(name, owner, pid, () => this._layout(), () => this._ctx.closePanel());
                this._players.set(name, player);
                this.actor.add_child(player.actor);
                this._layout();
            });
    }

    _removePlayer(name) {
        const player = this._players.get(name);
        if (!player)
            return;
        this._players.delete(name);
        player.destroy();
        this._layout();
    }

    // Playing players first; the empty label only when no card is visible.
    _layout() {
        const players = [...this._players.values()];
        players.sort((a, b) => Number(b.playing) - Number(a.playing));
        players.forEach((player, index) => this.actor.set_child_at_index(player.actor, index + 1));
        this._empty.visible = !players.some(player => player.actor.visible);
    }
};
