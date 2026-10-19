// Do Not Disturb that keeps notifications.
//
// Cinnamon's "display notifications" switch, when off, destroys each
// notification as it arrives (messageTray.js _updateState), so nothing
// reaches the side panel. While installed, this hook changes that: with the
// switch off, Source.notify skips the banner queue and hands the
// notification straight to applets, the same hand-off the tray makes when a
// banner finishes hiding. The switch itself is untouched, so it still
// matches System Settings, and uninstalling restores Cinnamon's behaviour.

const Gio = imports.gi.Gio;
const Main = imports.ui.main;
const MessageTray = imports.ui.messageTray;

const SCHEMA = 'org.cinnamon.desktop.notifications';
const KEY = 'display-notifications';

var DoNotDisturb = class DoNotDisturb {
    constructor() {
        this._settings = new Gio.Settings({ schema_id: SCHEMA });
        this._originalNotify = MessageTray.Source.prototype.notify;

        const dnd = this;
        const original = this._originalNotify;
        this._patchedNotify = function (notification) {
            if (!dnd.active)
                return original.call(this, notification);
            this.pushNotification(notification);
            Main.messageTray.emit('notify-applet-update', notification);
            // Nothing kept it (e.g. the stock applet ignores transient
            // notifications and there is no one else): let it go.
            if (notification.isTransient && !notification._destroyed && !notification._inNotificationBin)
                notification.destroy(MessageTray.NotificationDestroyedReason.EXPIRED);
        };
        MessageTray.Source.prototype.notify = this._patchedNotify;
    }

    get active() {
        return !this._settings.get_boolean(KEY);
    }

    set active(active) {
        this._settings.set_boolean(KEY, !active);
    }

    connectChanged(callback) {
        return this._settings.connect(`changed::${KEY}`, callback);
    }

    disconnect(id) {
        this._settings.disconnect(id);
    }

    // Only restore if nobody has patched on top of us since.
    destroy() {
        if (MessageTray.Source.prototype.notify === this._patchedNotify)
            MessageTray.Source.prototype.notify = this._originalNotify;
    }
};
