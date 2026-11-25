const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const source = fs.readFileSync(path.join(__dirname, '..', 'sirgon-globe.js'), 'utf8');
class FakeHTMLElement {attachShadow(){this.shadowRoot={getElementById:()=>null,querySelector:()=>null};}}
const { SirgonGlobe } = new Function('HTMLElement', 'customElements', 'window', source + '\nreturn { SirgonGlobe };')(FakeHTMLElement, { get: () => null, define: () => {} }, { customCards: [], location: { pathname: '/test' } });
const runTests = function(SirgonGlobe, assert) {
  const card=new SirgonGlobe();
  card._hass={states:{
    "weather.c":{attributes:{temperature_unit:"°C"}},
    "weather.f":{attributes:{temperature_unit:"°F"}},
  },config:{unit_system:{temperature:"°F"}}};
  const configure=(config={})=>card.setConfig({entity:"weather.c",...config});
  configure();assert(card.getCardSize()===5,"default layout");assert(card._temperatureText(20)==="20°","default Celsius");
  configure({temperature_unit:"F"});assert(card._temperatureText(20)==="68°","single Fahrenheit");
  configure({temperature_unit:"F",show_both_units:true});assert(card._temperatureText(20)==="68°F / 20°C","F primary, C input");
  configure({temperature_unit:"C",show_both_units:true,entity:"weather.f"});assert(card._temperatureText(68)==="20°C / 68°F","C primary, F input");
  assert(card._temperatureText(32)==="0°C / 32°F","freezing");
  assert(card._temperatureText(-40)==="-40°C / -40°F","negative");
  assert(card._temperatureText(0,"°C")==="0°C / 32°F","zero Celsius");
  assert(card._temperatureText(19.49,"C")==="19°C / 67°F","independent rounding");
  assert(card._temperatureText(293.15,"K")==="20°C / 68°F","Kelvin sensor");
  assert(card._temperatureText("unknown")==="--","unknown data");
  assert(card._temperatureText(null)==="--","null data");
  assert(card._temperatureText("unavailable")==="--","unavailable data");
  assert(card._temperatureText(20,"°C")==="20°C / 68°F","local sensor overrides weather unit");
  assert(card._temperatureMarkup(68).includes('20°<span class="temp-unit">C</span>')&&card._temperatureMarkup(68).includes('68°F'),"dual markup");
  configure({show_both_units:"false"});assert(card._temperatureText(20)==="20°","string false");
  configure({compact_mode:true,show_both_units:true});assert(card.getGridOptions().rows===2&&card.getGridOptions().min_rows===2,"compact sizing");
  const html=card._renderCompactSummary({name:"Orlando <x>",temperature:card._temperatureMarkup(20),highText:card._temperatureText(21),lowText:card._temperatureText(18),condition:"Cloudy",clock:{time:"21:05"},showForecast:true});
  assert(html.includes("Orlando &lt;x&gt;")&&html.includes("68°F")&&html.includes("21:05")&&html.includes("compact-forecast-btn")&&!html.includes("det-wrap")&&!html.includes("fc-strip"),"compact dual summary and escaping");
  configure({sources:[{id:"a",entity:"weather.c"},{id:"b",entity:"weather.f"}],active_source:"b",show_both_units:true,compact_mode:true});
  assert(card._temperatureText(68)==="20°C / 68°F","active source conversion");
  assert(card.getGridOptions().rows===3,"multi-source compact sizing");
  card._activeSourceId="a";assert(card._temperatureText(20)==="20°C / 68°F","source switch");
  configure({entity:"weather.missing",local_weather_station:true,show_both_units:true});assert(card._temperatureText(68)==="20°C / 68°F","HA unit fallback");
  configure({entity:"weather.c",show_both_units:true});card._forecastIconArgs=()=>({condition:"cloudy",isNight:false});card._day=()=>"Tue";card.getCachedIcon=()=>"<svg></svg>";
  const rows={},title={};card._updateForecastModal([{temperature:20,templow:10}],null,null,"daily",true,rows,title);
  assert(rows.innerHTML.includes("68°F")&&rows.innerHTML.includes("50°F")&&rows.innerHTML.includes("20°"),"dual daily forecast");
  card._updateForecastModal([{temperature:20}],null,null,"hourly",true,rows,title);assert(rows.innerHTML.includes("68°F")&&rows.innerHTML.includes("20°"),"dual hourly forecast");
  card._updateForecastModal([],null,null,"hourly",true,rows,title);assert(rows.innerHTML.includes("No hourly forecast available"),"missing forecast");
};
test('Temperature conversion and compact card regressions', () => runTests(SirgonGlobe, assert.ok));
