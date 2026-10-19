const Applet = imports.ui.applet;
const Settings = imports.ui.settings;
const Main = imports.ui.main;
const Util = imports.misc.util;
const CinnamonDesktop = imports.gi.CinnamonDesktop;
const Gio = imports.gi.Gio;
const St = imports.gi.St;

const { SidePanel } = require('./panel');
const { WidgetHost } = require('./widgets');

const UUID = 'sidepanel@PhillipMwaniki';
const GAP = 8;   // between the panel and the screen edges, in logical px

const DATE_FORMAT_FULL = CinnamonDesktop.WallClock.lctime_format('cinnamon', _('%A, %B %-e, %Y'));

class SidePanelApplet extends Applet.TextApplet {
    constructor(metadata, orientation, panelHeight, instanceId) {
        super(orientation, panelHeight, instanceId);
        this.setAllowedLayout(Applet.AllowedLayout.BOTH);
        this._orientation = orientation;

        this.settings = new Settings.AppletSettings(this, UUID, instanceId);
        this.settings.bind('use-custom-format', 'useCustomFormat', () => this._updateFormat());
        this.settings.bind('custom-format', 'customFormat', () => this._updateFormat());
        this.settings.bind('side', 'side');
        this.settings.bind('width', 'width');
        this.settings.bind('keybinding', 'keybinding', () => this._setKeybinding());
        this.settings.connect('changed::disabled-widgets', () => this.widgets.reload());
        this.settings.connect('changed::widget-order', () => this.widgets.reload());

        this._desktopSettings = new Gio.Settings({ schema_id: 'org.cinnamon.desktop.interface' });
        this._desktopSettingsId = this._desktopSettings.connect('changed', (settings, key) => {
            if (key === 'clock-use-24h' || key === 'clock-show-seconds')
                this._updateFormat();
        });
        this._clock = new CinnamonDesktop.WallClock();
        this._clockId = this._clock.connect('notify::clock', () => this._updateClock());

        this.panel = new SidePanel();
        this.panel.connect('open-state-changed', (panel, open) => this._onOpenStateChanged(open));
        this._buildFooter();

        this.widgets = new WidgetHost({
            container: this.panel.content,
            settings: this.settings,
            panel: this.panel,
            builtinDir: `${metadata.path}/widgets`,
        });
        this.widgets.load();

        this._updateFormat();
        this._setKeybinding();
    }

    on_applet_clicked() {
        this.toggle();
    }

    on_orientation_changed(orientation) {
        this._orientation = orientation;
        this._updateFormat();
    }

    on_applet_removed_from_panel() {
        Main.keybindingManager.removeXletHotKey(this, 'open');
        this._clock.disconnect(this._clockId);
        this._desktopSettings.disconnect(this._desktopSettingsId);
        this.widgets.destroy();
        this.panel.destroy();
        this.settings.finalize();
    }

    toggle() {
        this.panel.toggle(this._geometry());
    }

    _buildFooter() {
        const button = (iconName, label, callback) => {
            const button = new St.Button({ style_class: 'sidepanel-footer-button', can_focus: true, accessible_name: label });
            button.set_child(new St.Icon({ icon_name: iconName, icon_type: St.IconType.SYMBOLIC, style_class: 'popup-menu-icon' }));
            button.connect('clicked', () => {
                this.panel.close();
                callback();
            });
            new imports.ui.tooltips.Tooltip(button, label);
            return button;
        };
        this.panel.footer.add_child(new St.Widget({ x_expand: true }));
        this.panel.footer.add_child(button('preferences-system-time-symbolic', _('Date and time settings'),
            () => Util.spawnCommandLine('cinnamon-settings calendar')));
        this.panel.footer.add_child(button('emblem-system-symbolic', _('Side panel settings'),
            () => this.configureApplet()));
    }

    // Fill the work area of the clock's monitor, minus a small gap, on the
    // side the clock sits on unless the user picked one.
    _geometry() {
        const layout = Main.layoutManager;
        const monitorIndex = layout.findMonitorIndexForActor(this.actor);
        const monitor = layout.monitors[monitorIndex];
        const workArea = global.workspace_manager.get_active_workspace().get_work_area_for_monitor(monitorIndex);
        const scale = St.ThemeContext.get_for_stage(global.stage).scale_factor;
        const gap = GAP * scale;
        const width = Math.min(this.width * scale, workArea.width - 2 * gap);

        let side = this.side;
        if (side !== 'left' && side !== 'right') {
            const [x] = this.actor.get_transformed_position();
            side = x + this.actor.width / 2 > monitor.x + monitor.width / 2 ? 'right' : 'left';
        }

        return {
            side,
            x: side === 'right' ? workArea.x + workArea.width - width - gap : workArea.x + gap,
            y: workArea.y + gap,
            width,
            height: workArea.height - 2 * gap,
        };
    }

    _onOpenStateChanged(open) {
        this.actor.change_style_pseudo_class('checked', open);
        if (open)
            this.widgets.shown();
        else
            this.widgets.hidden();
    }

    _setKeybinding() {
        Main.keybindingManager.addXletHotKey(this, 'open', this.keybinding, () => this.toggle());
    }

    _updateFormat() {
        const vertical = this._orientation === St.Side.LEFT || this._orientation === St.Side.RIGHT;
        let format = null;   // null follows the system clock settings
        if (this.useCustomFormat) {
            format = this.customFormat;
        } else if (vertical) {
            const hours = this._desktopSettings.get_boolean('clock-use-24h') ? '%H' : '%l';
            const seconds = this._desktopSettings.get_boolean('clock-show-seconds') ? '%n%S' : '';
            format = `${hours}%n%M${seconds}`;
        }
        if (!this._clock.set_format_string(format)) {
            global.logError(`${UUID}: bad clock format "${format}"`);
            this._clock.set_format_string(null);
        }
        this._updateClock();
    }

    _updateClock() {
        this.set_applet_label(this._clock.get_clock().trim());
        this.set_applet_tooltip(this._clock.get_clock_for_format(DATE_FORMAT_FULL));
    }
}

function main(metadata, orientation, panelHeight, instanceId) {
    return new SidePanelApplet(metadata, orientation, panelHeight, instanceId);
}
