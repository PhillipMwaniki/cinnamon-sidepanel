// Current weather and a five-day forecast. The user picks a city with the
// search box in the widget; the last forecast is cached in the widget's
// settings so it shows straight away after a reload, or offline.

const Clutter = imports.gi.Clutter;
const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const St = imports.gi.St;
const { Client, describe } = require('./openmeteo');

const REFRESH_S = 30 * 60;           // background refresh
const STALE_MS = 15 * 60 * 1000;     // refresh on open if older than this
const SEARCH_DELAY_MS = 500;

function dayName(isoDate, index) {
    if (index === 0)
        return _('Today');
    const [year, month, day] = isoDate.split('-').map(Number);
    return GLib.DateTime.new_local(year, month, day, 12, 0, 0).format('%a');
}

// Follow the system 12/24-hour setting rather than the locale's default.
function formatTime(date) {
    const use24h = new Gio.Settings({ schema_id: 'org.cinnamon.desktop.interface' }).get_boolean('clock-use-24h');
    const dateTime = GLib.DateTime.new_from_unix_local(Math.floor(date.getTime() / 1000));
    return dateTime.format(use24h ? '%H:%M' : '%l:%M %p').trim();
}

function label(text, styleClass, params = {}) {
    return new St.Label(Object.assign({ text, style_class: styleClass }, params));
}

var Widget = class Widget {
    constructor(ctx) {
        this._ctx = ctx;
        this._client = new Client();
        this._searchId = 0;
        this._destroyed = false;

        this.actor = new St.BoxLayout({ vertical: true, style_class: 'sidepanel-weather' });
        this._buildSearch();
        this._buildForecast();
        this._message = label('', 'sidepanel-empty');
        this._message.clutter_text.line_wrap = true;
        this._retry = new St.Button({ label: _('Try again'), style_class: 'sidepanel-weather-chip', x_align: Clutter.ActorAlign.START, can_focus: true });
        this._retry.connect('clicked', () => this._refresh());
        this.actor.add_child(this._message);
        this.actor.add_child(this._retry);

        this._refreshId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, REFRESH_S, () => {
            this._refresh();
            return GLib.SOURCE_CONTINUE;
        });

        const cache = ctx.settings.get('cache', null);
        if (this._location() && cache) {
            this._show(cache.data, cache.fetchedAt);
            if (Date.now() - cache.fetchedAt > STALE_MS)
                this._refresh();
        } else if (this._location()) {
            this._refresh();
        } else {
            this._showSearch();
        }
    }

    onShown() {
        if (this._searchBox.visible) {
            this._entry.grab_key_focus();
            return;
        }
        const cache = this._ctx.settings.get('cache', null);
        if (!cache || Date.now() - cache.fetchedAt > STALE_MS)
            this._refresh();
    }

    destroy() {
        this._destroyed = true;
        GLib.source_remove(this._refreshId);
        if (this._searchId)
            GLib.source_remove(this._searchId);
        this._client.destroy();
    }

    _location() {
        return this._ctx.settings.get('location', null);
    }

    _units() {
        return this._ctx.settings.get('units', 'metric');
    }

    _buildSearch() {
        this._searchBox = new St.BoxLayout({ vertical: true, style_class: 'sidepanel-weather-search' });
        this._searchBox.add_child(label(_('Weather'), 'sidepanel-card-title'));
        this._entry = new St.Entry({ hint_text: _('Search for your city'), style_class: 'sidepanel-weather-entry', can_focus: true, x_expand: true });
        this._entry.clutter_text.connect('text-changed', () => this._queueSearch());
        this._entry.clutter_text.connect('activate', () => this._search());
        this._results = new St.BoxLayout({ vertical: true, style_class: 'sidepanel-weather-results' });
        this._searchStatus = label('', 'sidepanel-empty');
        this._cancelSearch = new St.Button({ label: _('Cancel'), style_class: 'sidepanel-weather-chip', x_align: Clutter.ActorAlign.START, can_focus: true });
        this._cancelSearch.connect('clicked', () => this._hideSearch());
        this._searchBox.add_child(this._entry);
        this._searchBox.add_child(this._searchStatus);
        this._searchBox.add_child(this._results);
        this._searchBox.add_child(this._cancelSearch);
        this.actor.add_child(this._searchBox);
    }

    _buildForecast() {
        this._forecastBox = new St.BoxLayout({ vertical: true, style_class: 'sidepanel-weather-forecast', visible: false });

        // Place, with buttons to change it and the units.
        const top = new St.BoxLayout({ style_class: 'sidepanel-weather-top' });
        this._place = label('', 'sidepanel-card-title', { x_expand: true, y_align: Clutter.ActorAlign.CENTER });
        this._unitsButton = new St.Button({ style_class: 'sidepanel-weather-chip', can_focus: true });
        this._unitsButton.connect('clicked', () => {
            this._ctx.settings.set('units', this._units() === 'metric' ? 'imperial' : 'metric');
            this._refresh();
        });
        const change = new St.Button({ style_class: 'sidepanel-weather-chip', can_focus: true, accessible_name: _('Change location') });
        change.set_child(new St.Icon({ icon_name: 'find-location-symbolic', icon_type: St.IconType.SYMBOLIC, icon_size: 14 }));
        change.connect('clicked', () => this._showSearch());
        top.add_child(this._place);
        top.add_child(this._unitsButton);
        top.add_child(change);
        this._forecastBox.add_child(top);

        const now = new St.BoxLayout({ style_class: 'sidepanel-weather-now' });
        this._icon = new St.Icon({ icon_size: 56, y_align: Clutter.ActorAlign.CENTER });
        const nowText = new St.BoxLayout({ vertical: true, y_align: Clutter.ActorAlign.CENTER, x_expand: true });
        this._temp = label('', 'sidepanel-weather-temp');
        this._condition = label('', 'sidepanel-weather-condition');
        this._details = label('', 'sidepanel-weather-details');
        this._details.clutter_text.line_wrap = true;
        nowText.add_child(this._temp);
        nowText.add_child(this._condition);
        nowText.add_child(this._details);
        now.add_child(this._icon);
        now.add_child(nowText);
        this._forecastBox.add_child(now);

        this._daysGrid = new Clutter.GridLayout({ column_homogeneous: true });
        this._days = new St.Widget({ layout_manager: this._daysGrid, x_expand: true, style_class: 'sidepanel-weather-days' });
        this._forecastBox.add_child(this._days);

        this._updated = label('', 'sidepanel-weather-updated');
        this._forecastBox.add_child(this._updated);
        this.actor.add_child(this._forecastBox);
    }

    _showSearch() {
        this._forecastBox.hide();
        this._message.hide();
        this._retry.hide();
        this._searchBox.show();
        this._cancelSearch.visible = Boolean(this._location());
        this._entry.text = '';
        this._results.destroy_all_children();
        this._searchStatus.hide();
        this._entry.grab_key_focus();
    }

    _hideSearch() {
        this._searchBox.hide();
        this._forecastBox.show();
    }

    _queueSearch() {
        if (this._searchId)
            GLib.source_remove(this._searchId);
        this._searchId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, SEARCH_DELAY_MS, () => {
            this._searchId = 0;
            this._search();
            return GLib.SOURCE_REMOVE;
        });
    }

    _search() {
        const text = this._entry.text.trim();
        this._results.destroy_all_children();
        if (text.length < 2) {
            this._searchStatus.hide();
            return;
        }
        this._searchStatus.text = _('Searching…');
        this._searchStatus.show();
        this._client.search(text).then(results => {
            if (this._destroyed || this._entry.text.trim() !== text)
                return;
            this._searchStatus.visible = results.length === 0;
            this._searchStatus.text = _('No places found');
            for (const result of results) {
                const button = new St.Button({ label: result.label, style_class: 'sidepanel-weather-result', x_align: Clutter.ActorAlign.FILL, can_focus: true });
                button.connect('clicked', () => this._choose(result));
                this._results.add_child(button);
            }
        }).catch(e => {
            if (this._destroyed)
                return;
            this._searchStatus.text = `${_('Search failed')}: ${e.message}`;
            this._searchStatus.show();
        });
    }

    _choose(location) {
        this._ctx.settings.set('location', location);
        this._ctx.settings.set('cache', null);
        this._searchBox.hide();
        this._refresh();
    }

    _refresh() {
        const location = this._location();
        if (!location || this._searchBox.visible)
            return;
        if (!this._forecastBox.visible) {
            this._message.text = _('Loading weather…');
            this._message.show();
            this._retry.hide();
        }
        const units = this._units();
        this._client.forecast(location, units).then(data => {
            if (this._destroyed)
                return;
            data.units = units;
            const fetchedAt = Date.now();
            this._ctx.settings.set('cache', { data, fetchedAt });
            this._show(data, fetchedAt);
        }).catch(e => {
            if (this._destroyed)
                return;
            global.logError(`sidepanel: weather: ${e.message}`);
            // Keep showing the cached forecast if there is one.
            if (this._forecastBox.visible) {
                this._updated.text = `${_('Couldn\'t update')}: ${e.message}`;
                return;
            }
            this._message.text = `${_('Couldn\'t load the weather')}: ${e.message}`;
            this._message.show();
            this._retry.show();
        });
    }

    _show(data, fetchedAt) {
        const location = this._location();
        const current = data.current;
        const daily = data.daily;
        const tempUnit = (data.current_units && data.current_units.temperature_2m) || '°';
        // Open-Meteo labels miles per hour "mp/h".
        const windUnit = ((data.current_units && data.current_units.wind_speed_10m) || '').replace('mp/h', 'mph');
        const degrees = value => `${Math.round(value)}°`;

        this._place.text = location ? location.name : '';
        this._unitsButton.label = data.units === 'imperial' ? '°F' : '°C';
        this._unitsButton.accessible_name = _('Switch units');

        const now = describe(current.weather_code, current.is_day === 1);
        this._icon.icon_name = now.icon;
        this._temp.text = `${Math.round(current.temperature_2m)}${tempUnit}`;
        this._condition.text = now.text;
        this._details.text = `${_('Feels like')} ${degrees(current.apparent_temperature)} · ${_('Wind')} ${Math.round(current.wind_speed_10m)} ${windUnit} · ${_('Humidity')} ${current.relative_humidity_2m}%`;

        this._days.destroy_all_children();
        daily.time.forEach((date, index) => {
            const day = describe(daily.weather_code[index]);
            const column = new St.BoxLayout({ vertical: true, style_class: 'sidepanel-weather-day' });
            column.add_child(label(dayName(date, index), 'sidepanel-weather-day-name', { x_align: Clutter.ActorAlign.CENTER }));
            column.add_child(new St.Icon({ icon_name: day.icon, icon_size: 28, x_align: Clutter.ActorAlign.CENTER }));
            column.add_child(label(degrees(daily.temperature_2m_max[index]), 'sidepanel-weather-day-max', { x_align: Clutter.ActorAlign.CENTER }));
            column.add_child(label(degrees(daily.temperature_2m_min[index]), 'sidepanel-weather-day-min', { x_align: Clutter.ActorAlign.CENTER }));
            const rain = daily.precipitation_probability_max && daily.precipitation_probability_max[index];
            if (rain)
                column.add_child(label(`${rain}%`, 'sidepanel-weather-day-rain', { x_align: Clutter.ActorAlign.CENTER }));
            this._daysGrid.attach(column, index, 0, 1, 1);
        });

        this._updated.text = `${_('Updated')} ${formatTime(new Date(fetchedAt))} · Open-Meteo`;

        this._message.hide();
        this._retry.hide();
        this._searchBox.hide();
        this._forecastBox.show();
    }
};
