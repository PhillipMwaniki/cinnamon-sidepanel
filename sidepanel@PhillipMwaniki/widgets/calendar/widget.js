// Month calendar. Uses the stock calendar applet's CSS classes so themes
// style it the same way, but doesn't depend on that applet's code, which
// expects its own settings and events objects.

const Clutter = imports.gi.Clutter;
const Cinnamon = imports.gi.Cinnamon;
const GLib = imports.gi.GLib;
const St = imports.gi.St;

const WEEKS = 6;

function sameDay(a, b) {
    return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function format(date, pattern) {
    const dateTime = GLib.DateTime.new_local(date.getFullYear(), date.getMonth() + 1, date.getDate(), 12, 0, 0);
    return dateTime.format(pattern);
}

var Widget = class Widget {
    constructor(ctx) {
        this._today = new Date();
        this._shown = new Date(this._today.getFullYear(), this._today.getMonth(), 1);

        this.actor = new St.BoxLayout({ vertical: true, style_class: 'calendar sidepanel-calendar', reactive: true });
        this.actor.connect('scroll-event', (actor, event) => this._onScroll(event));

        const header = new St.BoxLayout({ style_class: 'sidepanel-calendar-header' });
        const back = new St.Button({ style_class: 'calendar-change-month-back', can_focus: true, accessible_name: _('Previous month') });
        back.connect('clicked', () => this._changeMonth(-1));
        // Clicking the month name jumps back to today.
        this._monthButton = new St.Button({ x_expand: true, can_focus: true });
        this._monthLabel = new St.Label({ style_class: 'calendar-month-label' });
        this._monthButton.set_child(this._monthLabel);
        this._monthButton.connect('clicked', () => this._goToToday());
        const forward = new St.Button({ style_class: 'calendar-change-month-forward', can_focus: true, accessible_name: _('Next month') });
        forward.connect('clicked', () => this._changeMonth(1));
        header.add_child(back);
        header.add_child(this._monthButton);
        header.add_child(forward);
        this.actor.add_child(header);

        this._grid = new Clutter.GridLayout({ column_homogeneous: true, row_homogeneous: true });
        this._gridActor = new St.Widget({ layout_manager: this._grid, x_expand: true });
        this.actor.add_child(this._gridActor);

        this._render();
    }

    // Catch up after midnight or a long suspend while the panel was closed.
    onShown() {
        const now = new Date();
        if (!sameDay(now, this._today)) {
            this._today = now;
            this._shown = new Date(now.getFullYear(), now.getMonth(), 1);
            this._render();
        }
    }

    destroy() {
    }

    _changeMonth(delta) {
        this._shown = new Date(this._shown.getFullYear(), this._shown.getMonth() + delta, 1);
        this._render();
    }

    _goToToday() {
        this._today = new Date();
        this._shown = new Date(this._today.getFullYear(), this._today.getMonth(), 1);
        this._render();
    }

    _onScroll(event) {
        const direction = event.get_scroll_direction();
        if (direction === Clutter.ScrollDirection.UP)
            this._changeMonth(-1);
        else if (direction === Clutter.ScrollDirection.DOWN)
            this._changeMonth(1);
        else
            return Clutter.EVENT_PROPAGATE;
        return Clutter.EVENT_STOP;
    }

    _render() {
        this._gridActor.destroy_all_children();
        this._monthLabel.text = format(this._shown, '%B %Y');

        const weekStart = Cinnamon.util_get_week_start();
        const offset = (7 + this._shown.getDay() - weekStart) % 7;
        const first = new Date(this._shown.getFullYear(), this._shown.getMonth(), 1 - offset);

        for (let col = 0; col < 7; col++) {
            const day = new Date(first.getFullYear(), first.getMonth(), first.getDate() + col);
            const label = new St.Label({
                text: format(day, '%a').slice(0, 2),
                style_class: 'calendar-day-base calendar-day-heading',
                x_align: Clutter.ActorAlign.CENTER,
            });
            this._grid.attach(label, col, 0, 1, 1);
        }

        for (let i = 0; i < WEEKS * 7; i++) {
            const day = new Date(first.getFullYear(), first.getMonth(), first.getDate() + i);
            let styleClass = 'calendar-day-base calendar-day';
            if (day.getMonth() !== this._shown.getMonth())
                styleClass += ' calendar-other-month-day';
            styleClass += sameDay(day, this._today) ? ' calendar-today' : ' calendar-not-today';
            // A button rather than a label, as in the stock calendar, so
            // themes that size the day cell centre the number in it.
            const button = new St.Button({ label: String(day.getDate()), style_class: styleClass, reactive: false });
            this._grid.attach(button, i % 7, 1 + Math.floor(i / 7), 1, 1);
        }
    }
};
