// Notification history. The notification objects are shared with the stock
// notifications applet if it's on a panel: that applet moves each
// notification's own actor into its menu, so this widget draws separate
// cards from the notification's data and acts on the shared object, and
// dismissing in either place removes it from both.

const Clutter = imports.gi.Clutter;
const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const Pango = imports.gi.Pango;
const St = imports.gi.St;
const Main = imports.ui.main;
const MessageTray = imports.ui.messageTray;
const AppletManager = imports.ui.appletManager;
const { DoNotDisturb } = require('./dnd');

const MAX_SHOWN = 50;
const MAX_BODY_CHARS = 280;
const ICON_SIZE = 32;

// Follow the system 12/24-hour setting rather than the locale's default.
function formatTime(date) {
    const use24h = new Gio.Settings({ schema_id: 'org.cinnamon.desktop.interface' }).get_boolean('clock-use-24h');
    const dateTime = GLib.DateTime.new_from_unix_local(Math.floor(date.getTime() / 1000));
    return dateTime.format(use24h ? '%H:%M' : '%l:%M %p').trim();
}

function timeAgo(date) {
    const minutes = Math.floor((Date.now() - date.getTime()) / 60000);
    if (minutes < 1)
        return _('now');
    if (minutes < 60)
        return `${minutes} min ago`;
    const now = new Date();
    if (date.toDateString() === now.toDateString())
        return formatTime(date);
    return date.toLocaleDateString([], { day: 'numeric', month: 'short' });
}

function bodyText(notification) {
    const highlighter = notification._bodyUrlHighlighter;
    if (!highlighter)
        return '';
    const text = highlighter.actor.clutter_text.get_text() || '';
    return text.length > MAX_BODY_CHARS ? `${text.slice(0, MAX_BODY_CHARS - 1)}…` : text;
}

// The notification's own icon actor lives in its own layout, so copy it.
function iconFor(notification) {
    const original = notification._icon;
    if (original instanceof St.Icon && (original.gicon || original.icon_name))
        return new St.Icon({ gicon: original.gicon, icon_name: original.icon_name, icon_size: ICON_SIZE });
    try {
        const icon = notification.source.createNotificationIcon();
        if (icon instanceof St.Icon)
            icon.icon_size = ICON_SIZE;
        return icon;
    } catch (e) {
        return new St.Icon({ icon_name: 'dialog-information', icon_size: ICON_SIZE });
    }
}

class Card {
    constructor(notification, closePanel) {
        this.notification = notification;
        this._closePanel = closePanel;

        const critical = notification.urgency === MessageTray.Urgency.CRITICAL;
        this.actor = new St.BoxLayout({ style_class: critical ? 'sidepanel-notification-critical' : 'sidepanel-notification' });

        // Clicking the card does what clicking the banner would: usually
        // brings the app forward.
        // x_fill: a button centres a child narrower than itself, which
        // would push short notifications off to the right.
        this._main = new St.Button({ style_class: 'sidepanel-notification-main', x_expand: true, x_fill: true, can_focus: true });
        const row = new St.BoxLayout({ style_class: 'sidepanel-notification-row' });
        this._iconBin = new St.Bin({ y_align: Clutter.ActorAlign.START });
        const text = new St.BoxLayout({ vertical: true, x_expand: true });
        this._meta = new St.Label({ style_class: 'sidepanel-notification-meta' });
        this._title = new St.Label({ style_class: 'sidepanel-notification-title' });
        this._body = new St.Label({ style_class: 'sidepanel-notification-body' });
        this._body.clutter_text.line_wrap = true;
        this._body.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
        this._actions = new St.BoxLayout({ style_class: 'sidepanel-notification-actions' });
        text.add_child(this._meta);
        text.add_child(this._title);
        text.add_child(this._body);
        row.add_child(this._iconBin);
        row.add_child(text);
        this._main.set_child(row);
        this._main.connect('clicked', () => {
            this._closePanel();
            notification.actor.emit('clicked', 1);
        });

        const column = new St.BoxLayout({ vertical: true, x_expand: true });
        column.add_child(this._main);
        column.add_child(this._actions);

        const dismiss = new St.Button({ style_class: 'sidepanel-notification-dismiss', can_focus: true, accessible_name: _('Dismiss'), y_align: Clutter.ActorAlign.START });
        dismiss.set_child(new St.Icon({ icon_name: 'window-close-symbolic', icon_type: St.IconType.SYMBOLIC, icon_size: 12 }));
        dismiss.connect('clicked', () => notification.destroy(MessageTray.NotificationDestroyedReason.DISMISSED));

        this.actor.add_child(column);
        this.actor.add_child(dismiss);
        this.update();
    }

    update() {
        const notification = this.notification;
        this._iconBin.set_child(iconFor(notification));
        this._title.clutter_text.set_markup(notification.title || '');
        const body = bodyText(notification);
        this._body.text = body;
        this._body.visible = Boolean(body);
        this.refreshTime();

        // Re-use the notification's own buttons so the app's action
        // handling (and Cinnamon's) runs exactly as it would from the banner.
        this._actions.destroy_all_children();
        const area = notification._actionArea;
        for (const original of area ? area.get_children() : []) {
            const label = original.label || original.accessible_name || '';
            if (!label)
                continue;
            const button = new St.Button({ label, style_class: 'sidepanel-notification-action', can_focus: true });
            button.connect('clicked', () => {
                this._closePanel();
                original.emit('clicked', 1);
            });
            this._actions.add_child(button);
        }
        this._actions.visible = this._actions.get_n_children() > 0;
    }

    refreshTime() {
        const source = this.notification.source;
        const app = (source && source.title) || '';
        const time = timeAgo(this.notification._timestamp || new Date());
        this._meta.text = app ? `${app} · ${time}` : time;
    }

    destroy() {
        this.actor.destroy();
    }
}

var Widget = class Widget {
    constructor(ctx) {
        this._ctx = ctx;
        this._cards = new Map();   // notification -> Card
        this._destroyIds = new Map();

        this.actor = new St.BoxLayout({ vertical: true, style_class: 'sidepanel-notifications' });

        const header = new St.BoxLayout({ style_class: 'sidepanel-notifications-header' });
        this._heading = new St.Label({ style_class: 'sidepanel-card-title', y_align: Clutter.ActorAlign.CENTER, x_expand: true });
        this._dndButton = new St.Button({ style_class: 'sidepanel-notifications-dnd', can_focus: true, toggle_mode: true });
        const dndBox = new St.BoxLayout({ style_class: 'sidepanel-notifications-dnd-box' });
        this._dndIcon = new St.Icon({ icon_type: St.IconType.SYMBOLIC, icon_size: 14, y_align: Clutter.ActorAlign.CENTER });
        dndBox.add_child(this._dndIcon);
        dndBox.add_child(new St.Label({ text: _('Do not disturb'), y_align: Clutter.ActorAlign.CENTER }));
        this._dndButton.set_child(dndBox);
        this._dndButton.connect('clicked', () => { this._dnd.active = !this._dnd.active; });
        this._clear = new St.Button({ label: _('Clear all'), style_class: 'sidepanel-notifications-clear', can_focus: true });
        this._clear.connect('clicked', () => this._clearAll());
        header.add_child(this._heading);
        header.add_child(this._dndButton);
        header.add_child(this._clear);
        this.actor.add_child(header);

        this._list = new St.BoxLayout({ vertical: true, style_class: 'sidepanel-notifications-list' });
        this._empty = new St.Label({ text: _('No notifications'), style_class: 'sidepanel-empty' });
        this.actor.add_child(this._list);
        this.actor.add_child(this._empty);

        this._dnd = new DoNotDisturb();
        this._dndId = this._dnd.connectChanged(() => this._updateHeader());

        // Ask the tray to hand notifications over once their banner is done
        // (it only does that while at least one applet has said it wants them).
        MessageTray.extensionsHandlingNotifications++;
        this._trayId = Main.messageTray.connect('notify-applet-update', (tray, notification) => this._add(notification));

        // Pick up what the stock applet already holds, e.g. after a reload.
        const stock = AppletManager.getRunningInstancesForUuid('notifications@cinnamon.org')[0];
        for (const notification of (stock && stock.notifications) || [])
            this._add(notification);

        this._updateHeader();
    }

    onShown() {
        for (const card of this._cards.values())
            card.refreshTime();
    }

    destroy() {
        Main.messageTray.disconnect(this._trayId);
        MessageTray.extensionsHandlingNotifications--;
        this._dnd.disconnect(this._dndId);
        this._dnd.destroy();
        for (const [notification, id] of this._destroyIds)
            notification.disconnect(id);
        this._destroyIds.clear();
        for (const card of this._cards.values())
            card.destroy();
        this._cards.clear();
    }

    _add(notification) {
        if (notification._destroyed)
            return;
        const existing = this._cards.get(notification);
        if (existing) {
            // Same notification sent again with new content: refresh it and
            // move it to the top.
            existing.update();
            this._list.set_child_at_index(existing.actor, 0);
            return;
        }
        if (notification.isTransient)
            return;

        const card = new Card(notification, () => this._ctx.closePanel());
        this._cards.set(notification, card);
        this._list.insert_child_at_index(card.actor, 0);
        this._destroyIds.set(notification, notification.connect('destroy', () => this._remove(notification)));
        this._trim();
        this._updateHeader();
    }

    _remove(notification) {
        const card = this._cards.get(notification);
        if (!card)
            return;
        this._cards.delete(notification);
        this._destroyIds.delete(notification);
        card.destroy();
        this._updateHeader();
    }

    // Keep the newest; older ones stay in the stock applet if it's there.
    _trim() {
        const cards = this._list.get_children();
        for (let i = MAX_SHOWN; i < cards.length; i++)
            cards[i].hide();
        for (let i = 0; i < Math.min(MAX_SHOWN, cards.length); i++)
            cards[i].show();
    }

    _clearAll() {
        for (const notification of [...this._cards.keys()])
            notification.destroy(MessageTray.NotificationDestroyedReason.DISMISSED);
    }

    _updateHeader() {
        const count = this._cards.size;
        this._heading.text = count ? `${_('Notifications')} (${count})` : _('Notifications');
        this._empty.visible = count === 0;
        this._clear.visible = count > 0;

        const dnd = this._dnd.active;
        this._dndButton.checked = dnd;
        this._dndIcon.icon_name = dnd ? 'notifications-disabled-symbolic' : 'preferences-system-notifications-symbolic';
        this._trim();
    }
};
