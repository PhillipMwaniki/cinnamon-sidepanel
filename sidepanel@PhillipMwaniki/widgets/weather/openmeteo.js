// Open-Meteo client (https://open-meteo.com): free, no API key. Only the
// chosen city's name (when searching) and coordinates are sent.

const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const Soup = imports.gi.Soup;

const GEOCODING_URL = 'https://geocoding-api.open-meteo.com/v1/search';
const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
const FORECAST_DAYS = 5;

function query(params) {
    return Object.entries(params).map(([key, value]) => `${key}=${encodeURIComponent(value)}`).join('&');
}

var Client = class Client {
    constructor() {
        this._session = new Soup.Session({ user_agent: 'cinnamon-sidepanel', timeout: 15 });
        this._cancellable = new Gio.Cancellable();
    }

    search(name) {
        return this._get(GEOCODING_URL, { name, count: 6, language: 'en', format: 'json' })
            .then(data => (data.results || []).map(result => ({
                name: result.name,
                label: [result.name, result.admin1, result.country].filter(Boolean).join(', '),
                latitude: result.latitude,
                longitude: result.longitude,
            })));
    }

    forecast(location, units) {
        const imperial = units === 'imperial';
        return this._get(FORECAST_URL, {
            latitude: location.latitude,
            longitude: location.longitude,
            current: 'temperature_2m,apparent_temperature,weather_code,is_day,wind_speed_10m,relative_humidity_2m',
            daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max',
            temperature_unit: imperial ? 'fahrenheit' : 'celsius',
            wind_speed_unit: imperial ? 'mph' : 'kmh',
            timezone: 'auto',
            forecast_days: FORECAST_DAYS,
        });
    }

    destroy() {
        this._cancellable.cancel();
        this._session.abort();
    }

    _get(url, params) {
        const message = Soup.Message.new('GET', `${url}?${query(params)}`);
        return new Promise((resolve, reject) => {
            this._session.send_and_read_async(message, GLib.PRIORITY_DEFAULT, this._cancellable, (session, result) => {
                try {
                    const bytes = session.send_and_read_finish(result);
                    if (message.get_status() !== Soup.Status.OK)
                        throw new Error(`HTTP ${message.get_status()}`);
                    resolve(JSON.parse(new TextDecoder().decode(bytes.get_data())));
                } catch (e) {
                    reject(e);
                }
            });
        });
    }
};

// WMO weather interpretation codes, as Open-Meteo documents them.
const CODES = [
    [[0], 'Clear sky', 'weather-clear'],
    [[1], 'Mainly clear', 'weather-few-clouds'],
    [[2], 'Partly cloudy', 'weather-few-clouds'],
    [[3], 'Overcast', 'weather-overcast'],
    [[45, 48], 'Fog', 'weather-fog'],
    [[51, 53, 55], 'Drizzle', 'weather-showers-scattered'],
    [[56, 57], 'Freezing drizzle', 'weather-showers-scattered'],
    [[61, 63, 65], 'Rain', 'weather-showers'],
    [[66, 67], 'Freezing rain', 'weather-showers'],
    [[71, 73, 75, 77], 'Snow', 'weather-snow'],
    [[80, 81, 82], 'Rain showers', 'weather-showers-scattered'],
    [[85, 86], 'Snow showers', 'weather-snow'],
    [[95], 'Thunderstorm', 'weather-storm'],
    [[96, 99], 'Thunderstorm with hail', 'weather-storm'],
];

const NIGHT_ICONS = { 'weather-clear': 'weather-clear-night', 'weather-few-clouds': 'weather-few-clouds-night' };

function describe(code, isDay = true) {
    const match = CODES.find(([codes]) => codes.includes(code));
    if (!match)
        return { text: 'Unknown', icon: 'weather-severe-alert' };
    const [, text, icon] = match;
    return { text, icon: isDay ? icon : (NIGHT_ICONS[icon] || icon) };
}
