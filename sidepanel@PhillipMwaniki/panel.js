// The sliding panel itself: a full-height chrome actor that takes a modal
// grab while open, like a popup menu, so clicking outside or pressing Escape
// closes it.

const Clutter = imports.gi.Clutter;
const St = imports.gi.St;
const Main = imports.ui.main;
const Signals = imports.signals;

const ANIMATION_MS = 180;
const SLIDE_FRACTION = 0.3;   // of the panel width

var SidePanel = class SidePanel {
    constructor() {
        this.isOpen = false;
        this._side = 'right';
        this._capturedId = 0;

        // "menu" picks up the theme's popup background, border and radius.
        this.actor = new St.BoxLayout({ vertical: true, style_class: 'menu sidepanel', reactive: true, visible: false });

        this._scroll = new St.ScrollView({ style_class: 'sidepanel-scroll vfade', x_expand: true, y_expand: true });
        this._scroll.set_policy(St.PolicyType.NEVER, St.PolicyType.AUTOMATIC);
        this._scroll.set_clip_to_allocation(true);
        this.content = new St.BoxLayout({ vertical: true, style_class: 'sidepanel-content' });
        this._scroll.add_actor(this.content);
        this.actor.add_child(this._scroll);

        this.footer = new St.BoxLayout({ style_class: 'sidepanel-footer' });
        this.actor.add_child(this.footer);

        Main.layoutManager.addChrome(this.actor, { visibleInFullscreen: false, affectsStruts: false });
    }

    toggle(geometry) {
        if (this.isOpen)
            this.close();
        else
            this.open(geometry);
    }

    open({ side, x, y, width, height }) {
        if (this.isOpen)
            return;
        if (!Main.pushModal(this.actor))
            return;
        this.isOpen = true;
        this._side = side;

        this.actor.set_position(x, y);
        this.actor.set_size(width, height);
        this._capturedId = global.stage.connect('captured-event', (stage, event) => this._onCapturedEvent(event));

        this.actor.remove_all_transitions();
        this.actor.translation_x = this._slideOffset();
        this.actor.opacity = 0;
        this.actor.show();
        this.actor.ease({
            translation_x: 0,
            opacity: 255,
            duration: ANIMATION_MS,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });
        this.emit('open-state-changed', true);
    }

    close(animate = true) {
        if (!this.isOpen)
            return;
        this.isOpen = false;
        global.stage.disconnect(this._capturedId);
        this._capturedId = 0;
        Main.popModal(this.actor);

        this.actor.remove_all_transitions();
        if (animate) {
            this.actor.ease({
                translation_x: this._slideOffset(),
                opacity: 0,
                duration: ANIMATION_MS,
                mode: Clutter.AnimationMode.EASE_IN_QUAD,
                onComplete: () => {
                    if (!this.isOpen)
                        this.actor.hide();
                },
            });
        } else {
            this.actor.hide();
        }
        this.emit('open-state-changed', false);
    }

    destroy() {
        this.close(false);
        Main.layoutManager.removeChrome(this.actor);
        this.actor.destroy();
    }

    _slideOffset() {
        const distance = this.actor.width * SLIDE_FRACTION;
        return this._side === 'right' ? distance : -distance;
    }

    _onCapturedEvent(event) {
        const type = event.type();
        if (type === Clutter.EventType.KEY_PRESS) {
            if (event.get_key_symbol() === Clutter.KEY_Escape) {
                this.close();
                return Clutter.EVENT_STOP;
            }
        } else if (type === Clutter.EventType.BUTTON_PRESS || type === Clutter.EventType.TOUCH_BEGIN) {
            // Swallow the click, as popup menus do, so that clicking the clock
            // to close the panel doesn't immediately reopen it.
            if (!this.actor.contains(event.get_source())) {
                this.close();
                return Clutter.EVENT_STOP;
            }
        }
        return Clutter.EVENT_PROPAGATE;
    }
};
Signals.addSignalMethods(SidePanel.prototype);
