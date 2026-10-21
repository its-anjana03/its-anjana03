// Forges the animated profile SVGs in /assets. The heat of the forge follows recent GitHub activity.
// No dependencies: `node scripts/forge.mjs` (needs GITHUB_TOKEN or GH_TOKEN; falls back to cached data).
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'src');
const OUT = path.join(ROOT, 'assets');
const CACHE = path.join(OUT, 'data.json');
const cfg = JSON.parse(await readFile(path.join(ROOT, 'profile.json'), 'utf8'));
await mkdir(OUT, { recursive: true });

// ---------- brand tokens (from forgestudio.web.lk) ----------
const C = {
  ink: '#0A0908',
  ink2: '#121110',
  steel: '#2B2B2B',
  steel2: '#3A3936',
  bone: '#F4EFE6',
  dim: '#A8A196',
  mute: '#8A8378',
  gold: '#FFC247',
  ember: '#FF8A00',
  line: 'rgba(244,239,230,.12)',
  line2: 'rgba(244,239,230,.22)',
};
const HEAT_STOPS = [[0, '#FFE7A6'], [0.32, '#FFC247'], [0.62, '#FF8A00'], [0.86, '#7A3510'], [1, '#2B2B2B']];
const SANS = `'GS', 'General Sans', 'Segoe UI', -apple-system, BlinkMacSystemFont, system-ui, sans-serif`;
const MONO = `ui-monospace, 'SF Mono', 'Cascadia Mono', Consolas, Menlo, monospace`;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MARK = 'M2962,267L2499,0L1038,392L771,854L1234,1121L504,1317L0,2190L516,2488L1162,2314L1430,1851L2160,1656L2427,1193L1964,925L2695,729Z';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const r1 = (n) => Math.round(n * 10) / 10;
const pad = (n) => String(n).padStart(2, '0');

// Deterministic randomness keeps the SVGs stable between runs, so commits only change when data does.
function rng(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- fonts ----------
const font = async (w) => (await readFile(path.join(SRC, 'fonts', `general-sans-${w}.woff2`))).toString('base64');
const FONT_FACES = {
  600: `@font-face{font-family:'GS';font-weight:600;src:url(data:font/woff2;base64,${await font(600)}) format('woff2')}`,
  400: `@font-face{font-family:'GS';font-weight:400;src:url(data:font/woff2;base64,${await font(400)}) format('woff2')}`,
};

// Resting state of every element is its final state; animations declare only "from",
// so reduced-motion viewers get the finished, still frame.
const BASE_CSS = `
  .s{font-family:${SANS}} .m{font-family:${MONO}}
  @keyframes up{from{opacity:0;transform:translateY(12px)}}
  .up{animation:up .8s cubic-bezier(.22,1,.36,1) backwards}
  @keyframes fade{from{opacity:0}}
  .fade{animation:fade 1s ease-out backwards}
  @keyframes gx{from{transform:scaleX(0)}}
  .gx{transform-box:fill-box;transform-origin:0 50%;animation:gx 1.4s cubic-bezier(.22,1,.36,1) backwards}
  @keyframes gy{from{transform:scaleY(0)}}
  .gy{transform-box:fill-box;transform-origin:50% 0;animation:gy 1.2s cubic-bezier(.65,0,.35,1) backwards}
  @keyframes pulse{0%,100%{opacity:1}50%{opacity:.45}}
  .pulse{animation:pulse 2.2s ease-in-out infinite}
  @media (prefers-reduced-motion:reduce){*{animation:none!important}}
`;

function svg(w, h, { css = '', fonts = [], label, body }) {
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(label)}">
<style>${fonts.map((f) => FONT_FACES[f]).join('')}${BASE_CSS}${css}</style>
${body}
</svg>
`;
}

const glow = (id, blur) => `<filter id="${id}" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="${blur}" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>`;
const heatStops = (stops = HEAT_STOPS) => stops.map(([o, c]) => `<stop offset="${o}" stop-color="${c}"/>`).join('');

function wrap(text, max) {
  const lines = [];
  let cur = '';
  for (const word of text.split(/\s+/)) {
    if (cur && (cur + ' ' + word).length > max) {
      lines.push(cur);
      cur = word;
    } else cur = cur ? cur + ' ' + word : word;
  }
  if (cur) lines.push(cur);
  return lines;
}

// ---------- data ----------
const QUERY = `query($login:String!){ user(login:$login){
  repositories(ownerAffiliations:OWNER, isFork:false, privacy:PUBLIC, first:100){ nodes{ name description homepageUrl url } }
  contributionsCollection{ contributionCalendar{ totalContributions weeks{ contributionDays{ date contributionCount } } } } } }`;

async function fetchUser() {
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (!token) throw new Error('GITHUB_TOKEN is not set');
  const res = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: { Authorization: `bearer ${token}`, 'Content-Type': 'application/json', 'User-Agent': 'forge-profile' },
    body: JSON.stringify({ query: QUERY, variables: { login: cfg.login } }),
  });
  const json = await res.json();
  if (!res.ok || json.errors || !json.data?.user) throw new Error(JSON.stringify(json.errors ?? json));
  return json.data.user;
}

let snapshot;
try {
  snapshot = { fetchedAt: new Date().toISOString(), user: await fetchUser() };
  await writeFile(CACHE, JSON.stringify(snapshot, null, 2) + '\n');
} catch (err) {
  console.warn(`Live fetch failed, reusing cached data: ${err.message}`);
  snapshot = JSON.parse(await readFile(CACHE, 'utf8'));
}
const { user, fetchedAt } = snapshot;
const repoByName = Object.fromEntries(user.repositories.nodes.map((r) => [r.name, r]));
const days = user.contributionsCollection.contributionCalendar.weeks.flatMap((w) => w.contributionDays);

// Heat: commits over the last 21 days, each day cooling by 16%, so a quiet week lets the forge die down.
const recent = days.slice(-21);
const heatRaw = recent.reduce((s, d, i) => s + d.contributionCount * Math.pow(0.84, recent.length - 1 - i), 0);
const heat = Math.min(1, heatRaw / 14);
const temp = Math.round((500 + heat * 800) / 10) * 10;
const week = days.slice(-7).reduce((s, d) => s + d.contributionCount, 0);
const state = heat < 0.2 ? 'EMBERS' : heat < 0.45 ? 'WARMING' : heat < 0.75 ? 'FORGING' : 'WHITE HOT';

const hex = (c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
function heatColor(t) {
  const stops = [[0, '#5C1A0B'], [0.35, '#B8410F'], [0.6, '#FF8A00'], [0.82, '#FFC247'], [1, '#FFE7A6']];
  for (let i = 1; i < stops.length; i++) {
    if (t <= stops[i][0]) {
      const [t0, c0] = stops[i - 1], [t1, c1] = stops[i];
      const k = (t - t0) / (t1 - t0);
      return '#' + hex(c0).map((v, j) => Math.round(v + (hex(c1)[j] - v) * k).toString(16).padStart(2, '0')).join('');
    }
  }
  return stops.at(-1)[1];
}
const HOT = heatColor(heat);

const local = new Date(Date.parse(fetchedAt) + 5.5 * 3600e3); // Colombo, UTC+05:30
const updated = `${local.getUTCDate()} ${MONTHS[local.getUTCMonth()]}, ${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())} Colombo`;

// ---------- forge.svg (hero) ----------
function hero() {
  const W = 1000, H = 460, rand = rng(1300);
  const S = 220 / 2488, MX = 60, MY = 118;
  const cx = r1(MX + 1481 * S), cy = r1(MY + 1244 * S);
  const P = 3.6, first = 1.8;
  let body = `<defs>
  ${glow('glow', 3)}${glow('glowBig', 7)}
  <filter id="halo" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="160"/></filter>
  <linearGradient id="heat" gradientUnits="userSpaceOnUse" x1="2750" y1="80" x2="250" y2="2420">${heatStops()}</linearGradient>
  <linearGradient id="nameHeat" x1="0" x2="1">${heatStops(HEAT_STOPS.slice(0, 4))}</linearGradient>
  <linearGradient id="bar" gradientUnits="userSpaceOnUse" x1="380" x2="960">
    <stop offset="0" stop-color="#5C1A0B"/><stop offset=".35" stop-color="#B8410F"/><stop offset=".6" stop-color="${C.ember}"/><stop offset=".82" stop-color="${C.gold}"/><stop offset="1" stop-color="#FFE7A6"/></linearGradient>
  <radialGradient id="bed" cx="50%" cy="100%" r="70%"><stop offset="0" stop-color="${HOT}" stop-opacity=".9"/><stop offset=".5" stop-color="${HOT}" stop-opacity=".18"/><stop offset="1" stop-color="${HOT}" stop-opacity="0"/></radialGradient>
  <clipPath id="frame"><rect x="1" y="1" width="${W - 2}" height="${H - 2}" rx="18"/></clipPath>
</defs>
<rect x="1" y="1" width="${W - 2}" height="${H - 2}" rx="18" fill="${C.ink}"/>
<g clip-path="url(#frame)">`;

  // Diagonal strike streaks, a few carrying a travelling spark.
  for (let i = 0; i < 11; i++) {
    const x = 80 + i * 105 + rand() * 40;
    const x2 = x - 300, len = Math.hypot(300, 520);
    body += `\n  <line x1="${r1(x)}" y1="-20" x2="${r1(x2)}" y2="500" stroke="${C.gold}" stroke-opacity=".05"/>`;
    if (i % 3 === 1) {
      body += `\n  <line x1="${r1(x)}" y1="-20" x2="${r1(x2)}" y2="500" stroke="${C.gold}" stroke-opacity=".55" stroke-width="1.2" stroke-dasharray="46 ${r1(len * 2)}" class="streak" style="animation-delay:${r1(i * 0.9)}s;--len:${r1(len + 46)}"/>`;
    }
  }

  // Forge bed glow, flickering, brighter when hotter.
  const bedO = r1(0.22 + 0.55 * heat);
  body += `\n  <ellipse cx="300" cy="500" rx="520" ry="230" fill="url(#bed)" class="flick" style="--o:${bedO}" opacity="${bedO}"/>`;

  // Embers drifting up from the bed.
  const embers = 6 + Math.round(heat * 26);
  for (let i = 0; i < embers; i++) {
    const x = rand() * 760 + 20, r = 0.8 + rand() * 1.6, dur = 5 + rand() * 5;
    const col = rand() < 0.5 ? C.gold : C.ember;
    body += `\n  <circle cx="${r1(x)}" cy="${r1(470 - rand() * 30)}" r="${r1(r)}" fill="${col}" opacity="0" class="ember" style="--dx:${r1((rand() - 0.5) * 70)}px;--rise:${r1(160 + rand() * 260)}px;--o:${r1(0.5 + rand() * 0.5)};animation-duration:${r1(dur)}s;animation-delay:${r1(-rand() * dur)}s"/>`;
  }
  body += '\n</g>';

  // The FORGE mark: cold steel that heats up, then gets struck.
  body += `
<g transform="translate(${MX} ${MY}) scale(${S.toFixed(5)})">
  <path d="${MARK}" fill="${HOT}" filter="url(#halo)" class="flick" style="--o:${r1(0.25 + 0.55 * heat)};animation-delay:1.6s" opacity="${r1(0.25 + 0.55 * heat)}"/>
  <path d="${MARK}" fill="${C.steel}"/>
  <path d="${MARK}" fill="url(#heat)" class="heatup"/>
</g>
<circle cx="${cx}" cy="${cy}" r="26" fill="#FFF4D6" opacity="0" filter="url(#glowBig)" class="flash" style="animation-delay:${first}s"/>
<circle cx="${cx}" cy="${cy}" r="30" fill="none" stroke="${C.gold}" stroke-width="2" opacity="0" class="wave" style="animation-delay:${first}s"/>`;

  const sparks = 10 + Math.round(heat * 22);
  const reach = 0.65 + 0.6 * heat;
  body += `\n<g transform="translate(${cx} ${cy})" filter="url(#glow)">`;
  for (let i = 0; i < sparks; i++) {
    const a = rand() * Math.PI * 2, d = (50 + rand() * 120) * reach, len = 5 + rand() * 11;
    const col = rand() < 0.35 ? '#FFE7A6' : rand() < 0.6 ? C.gold : C.ember;
    body += `\n  <g class="spark" opacity="0" style="--dx:${r1(Math.cos(a) * d)}px;--dy:${r1(Math.sin(a) * d)}px;animation-delay:${r1(first + rand() * 0.08)}s"><line x2="${r1(len)}" stroke="${col}" stroke-width="1.6" stroke-linecap="round" transform="rotate(${r1((a * 180) / Math.PI)})"/></g>`;
  }
  body += '\n</g>';

  // Name, molten at first, cooling to bone.
  body += `
<g class="up" style="animation-delay:.2s">
  <text x="380" y="148" class="m" font-size="11" letter-spacing="3" fill="${C.mute}">${esc(cfg.kicker)}</text>
</g>
<g class="up" style="animation-delay:.45s">
  <text x="376" y="214" class="s" font-size="60" font-weight="600" letter-spacing="-1.5" fill="${C.bone}">${esc(cfg.name)}</text>
  <text x="376" y="214" class="s cool" font-size="60" font-weight="600" letter-spacing="-1.5" fill="url(#nameHeat)" filter="url(#glow)" opacity="0">${esc(cfg.name)}</text>
</g>
<g class="up" style="animation-delay:.7s">
  <text x="380" y="254" class="s" font-size="21" fill="${C.bone}">${esc(cfg.role)}<tspan fill="${C.gold}">.</tspan></text>
  <text x="380" y="284" class="s" font-size="15" fill="${C.dim}" xml:space="preserve">${esc(cfg.disciplines)}</text>
  <text x="380" y="312" class="m" font-size="10.5" letter-spacing="2" fill="${C.mute}">${esc(cfg.study)}</text>
</g>`;

  // Live heat gauge.
  const fillW = r1(580 * Math.max(0.05, heat));
  body += `
<g class="up" style="animation-delay:1s">
  <text x="380" y="362" class="m" font-size="10.5" letter-spacing="2.4" fill="${C.mute}">FORGE TEMPERATURE · LAST 21 DAYS</text>
  <text x="960" y="362" text-anchor="end" class="m" font-size="10.5" letter-spacing="2.4" fill="${HOT}">${state}</text>
  <rect x="380" y="374" width="580" height="6" rx="3" fill="${C.steel}"/>
</g>
<rect x="380" y="374" width="${fillW}" height="6" rx="3" fill="url(#bar)" filter="url(#glow)" class="gx" style="animation-delay:1.3s"/>
<g class="fade" style="animation-delay:2.4s"><circle cx="${r1(380 + fillW)}" cy="377" r="4.5" fill="${HOT}" filter="url(#glowBig)" class="pulse"/></g>
<g class="up" style="animation-delay:1.5s">
  <text x="380" y="424" class="m" font-size="11" letter-spacing="2.4" fill="${C.mute}">IGNITE</text>
  <text x="440" y="425" class="s" font-size="28" font-weight="600" fill="${C.bone}">${temp.toLocaleString('en-US')}<tspan fill="${HOT}">°C</tspan></text>
  <text x="960" y="413" text-anchor="end" class="m" font-size="10.5" fill="${C.dim}">${week} contribution${week === 1 ? '' : 's'} this week</text>
  <text x="960" y="430" text-anchor="end" class="m" font-size="10.5" fill="${C.mute}">stoked ${esc(updated)}</text>
</g>
<rect x="1" y="1" width="${W - 2}" height="${H - 2}" rx="18" fill="none" stroke="${C.line}"/>`;

  const css = `
  @keyframes streak{from{stroke-dashoffset:var(--len)}to{stroke-dashoffset:0}}
  .streak{animation:streak 5s cubic-bezier(.5,0,.5,1) infinite;stroke-dashoffset:9999px}
  @keyframes flick{0%,100%{opacity:var(--o)}22%{opacity:calc(var(--o)*.78)}41%{opacity:calc(var(--o)*1.08)}63%{opacity:calc(var(--o)*.86)}81%{opacity:calc(var(--o)*1.02)}}
  .flick{animation:flick 3.4s ease-in-out infinite}
  @keyframes ember{0%{opacity:0;transform:translate(0,0)}12%{opacity:var(--o)}75%{opacity:calc(var(--o)*.5)}100%{opacity:0;transform:translate(var(--dx),calc(var(--rise)*-1))}}
  .ember{animation:ember linear infinite}
  @keyframes heatup{from{opacity:0}}
  .heatup{animation:heatup 1.5s .3s ease-in backwards}
  @keyframes flash{0%{opacity:.95;transform:scale(.3)}10%{opacity:0;transform:scale(1.8)}100%{opacity:0}}
  .flash{transform-box:fill-box;transform-origin:center;animation:flash ${P}s ease-out infinite}
  @keyframes wave{0%{opacity:.8;transform:scale(.4)}22%{opacity:0;transform:scale(3.2)}100%{opacity:0}}
  .wave{transform-box:fill-box;transform-origin:center;animation:wave ${P}s cubic-bezier(.2,.8,.2,1) infinite}
  @keyframes spark{0%{opacity:1;transform:translate(0,0)}14%{opacity:.95;transform:translate(calc(var(--dx)*.78),calc(var(--dy)*.78))}32%{opacity:0;transform:translate(var(--dx),calc(var(--dy) + 30px))}100%{opacity:0;transform:translate(var(--dx),calc(var(--dy) + 30px))}}
  .spark{animation:spark ${P}s cubic-bezier(.15,.7,.3,1) infinite}
  @keyframes cool{0%{opacity:1}100%{opacity:0}}
  .cool{animation:cool 3s ${first}s ease-in backwards}`;
  const label = `${cfg.name}, ${cfg.role}. FORGE Studio. Forge temperature ${temp}°C (${state.toLowerCase()}), from ${week} contributions this week.`;
  return svg(W, H, { css, fonts: [400, 600], label, body });
}

// ---------- code-N.svg (ingot cards) ----------
function codeCard(p, i) {
  const W = 480, H = 210;
  const repo = repoByName[p.repo] ?? {};
  const desc = wrap(p.description ?? repo.description ?? '', 58).slice(0, 2);
  const live = (repo.homepageUrl || '').replace(/^https?:\/\//, '').replace(/\/$/, '');
  let tx = 28;
  const tags = p.tags.map((t, j) => {
    const w = Math.round(t.length * 6.8 + 24);
    const g = `<g class="up" style="animation-delay:${r1(0.7 + j * 0.08)}s"><rect x="${tx}" y="140" width="${w}" height="24" rx="4" fill="${C.ink}" stroke="${C.line2}"/><text x="${tx + w / 2}" y="156" text-anchor="middle" class="m" font-size="11" fill="${C.dim}">${esc(t)}</text></g>`;
    tx += w + 8;
    return g;
  }).join('\n');
  const body = `<defs>${glow('glow', 4)}
  <linearGradient id="ingot" x1="0" y1="0" x2="1" y2="1">${heatStops(HEAT_STOPS.slice(0, 4))}</linearGradient>
  <linearGradient id="edge" x1="0" x2="1"><stop offset="0" stop-color="${C.ember}" stop-opacity="0"/><stop offset=".5" stop-color="${C.gold}"/><stop offset="1" stop-color="${C.ember}" stop-opacity="0"/></linearGradient></defs>
<rect x="1" y="1" width="${W - 2}" height="${H - 2}" rx="14" fill="${C.ink2}" stroke="${C.line}"/>
<rect x="24" y="1" width="${W - 48}" height="2" fill="url(#edge)" class="gx" style="animation-delay:.2s"/>
<g transform="translate(${W - 92} 26)">
  <path d="M8 0H60L68 26H0Z" fill="${C.steel2}"/>
  <path d="M8 0H60L68 26H0Z" fill="url(#ingot)" filter="url(#glow)" class="cooling"/>
  <path d="M14 6H54" stroke="${C.bone}" stroke-opacity=".25"/>
</g>
<g class="up" style="animation-delay:.15s">
  <text x="28" y="40" class="m" font-size="10.5" letter-spacing="2.2" fill="${C.mute}">CODE · ${pad(i + 1)} · ${esc(p.kicker.toUpperCase())}</text>
  <text x="28" y="76" class="s" font-size="26" font-weight="600" letter-spacing="-.5" fill="${C.bone}">${esc(p.title)}</text>
</g>
<g class="up" style="animation-delay:.35s">
  ${desc.map((l, j) => `<text x="28" y="${104 + j * 19}" class="s" font-size="13.5" fill="${C.dim}">${esc(l)}</text>`).join('\n  ')}
</g>
${tags}
<g class="up" style="animation-delay:1s">
  <line x1="28" x2="${W - 28}" y1="180" y2="180" stroke="${C.line}"/>
  <text x="28" y="${H - 10}" class="m" font-size="10.5" letter-spacing="1.6" fill="${C.gold}">${live ? `LIVE ↗  ${esc(live)}` : `REPO ↗  ${esc(cfg.login)}/${esc(p.repo)}`}</text>
</g>`;
  const css = `
  @keyframes cooling{0%{opacity:1}100%{opacity:.55}}
  .cooling{opacity:.55;animation:cooling 3.5s .4s ease-out backwards}`;
  return svg(W, H, { css, fonts: [400, 600], label: `${p.title}: ${desc.join(' ')}`, body });
}

// ---------- poster-N.svg (campaign work, revealed by a burning edge) ----------
async function posterCard(p, i) {
  const W = 240, H = 386, IH = 300;
  const img = (await readFile(path.join(SRC, 'posters', p.image))).toString('base64');
  const d = r1(0.2 + i * 0.3);
  const body = `<defs>${glow('glow', 3)}
  <clipPath id="img"><rect x="1" y="1" width="${W - 2}" height="${IH}" rx="12"/></clipPath>
  <clipPath id="reveal"><rect x="0" y="0" width="${W}" height="${IH + 2}" class="gy" style="animation-delay:${d}s"/></clipPath>
  <linearGradient id="shade" x1="0" y1="0" x2="0" y2="1"><stop offset=".6" stop-color="${C.ink}" stop-opacity="0"/><stop offset="1" stop-color="${C.ink}" stop-opacity=".55"/></linearGradient></defs>
<rect x="1" y="1" width="${W - 2}" height="${H - 2}" rx="12" fill="${C.ink2}" stroke="${C.line}"/>
<g clip-path="url(#img)">
  <g clip-path="url(#reveal)">
    <image href="data:image/webp;base64,${img}" xlink:href="data:image/webp;base64,${img}" x="1" y="1" width="${W - 2}" height="${IH}" preserveAspectRatio="xMidYMid slice"/>
    <rect x="1" y="1" width="${W - 2}" height="${IH}" fill="url(#shade)"/>
  </g>
  <rect x="0" y="-3" width="${W}" height="3" fill="${C.gold}" filter="url(#glow)" opacity="0" class="burn" style="animation-delay:${d}s"/>
</g>
<g class="up" style="animation-delay:${r1(d + 0.9)}s">
  <text x="16" y="${IH + 28}" class="m" font-size="9.5" letter-spacing="1.8" fill="${C.mute}">${esc(p.meta)}</text>
  <text x="16" y="${IH + 52}" class="s" font-size="17" font-weight="600" fill="${C.bone}">${esc(p.title)} <tspan fill="${C.gold}">→</tspan></text>
  <text x="16" y="${IH + 72}" class="s" font-size="12" fill="${C.dim}">${esc(p.role)}</text>
</g>`;
  const css = `
  @keyframes burn{0%{opacity:1;transform:translateY(0)}92%{opacity:1;transform:translateY(${IH + 3}px)}100%{opacity:0;transform:translateY(${IH + 3}px)}}
  .burn{animation:burn 1.2s cubic-bezier(.65,0,.35,1)}`;
  return svg(W, H, { css, fonts: [600], label: `${p.title}, ${p.role}. ${p.alt}`, body });
}

// ---------- timeline.svg ----------
function timeline() {
  const W = 1000, H = 266, Y = 136, X0 = 110, X1 = 890;
  const items = cfg.timeline;
  const step = (X1 - X0) / (items.length - 1);
  const T = 3.2; // seconds for the heat to travel the rail
  let body = `<defs>${glow('glow', 3)}${glow('glowBig', 6)}
  <linearGradient id="rail" gradientUnits="userSpaceOnUse" x1="${X0}" x2="${X1}"><stop offset="0" stop-color="#7A3510"/><stop offset=".45" stop-color="${C.ember}"/><stop offset=".8" stop-color="${C.gold}"/><stop offset="1" stop-color="#FFE7A6"/></linearGradient>
  <linearGradient id="sheen" x1="0" x2="1"><stop offset="0" stop-color="#FFE7A6" stop-opacity="0"/><stop offset=".5" stop-color="#FFE7A6" stop-opacity=".9"/><stop offset="1" stop-color="#FFE7A6" stop-opacity="0"/></linearGradient>
  <clipPath id="railClip"><rect x="${X0}" y="${Y - 3}" width="${X1 - X0}" height="6" rx="3"/></clipPath></defs>
<rect x="1" y="1" width="${W - 2}" height="${H - 2}" rx="18" fill="${C.ink}" stroke="${C.line}"/>
<rect x="${X0}" y="${Y - 2}" width="${X1 - X0}" height="4" rx="2" fill="${C.steel}"/>
<rect x="${X0}" y="${Y - 2}" width="${X1 - X0}" height="4" rx="2" fill="url(#rail)" filter="url(#glow)" class="gx" style="animation-duration:${T}s;animation-timing-function:linear;animation-delay:.3s"/>
<g clip-path="url(#railClip)"><rect x="${X0 - 120}" y="${Y - 3}" width="120" height="6" fill="url(#sheen)" class="sheen"/></g>`;
  items.forEach((it, i) => {
    const x = r1(X0 + i * step);
    const t = r1(0.3 + (i / (items.length - 1)) * T);
    const above = i % 2 === 0;
    const lines = wrap(it.title, 24).slice(0, 2);
    const yearY = above ? Y - 26 : Y + 38;
    const firstLine = above ? yearY - 20 - (lines.length - 1) * 17 : yearY + 22;
    body += `
<line x1="${x}" x2="${x}" y1="${above ? Y - 16 : Y + 8}" y2="${above ? Y - 8 : Y + 16}" stroke="${C.line2}"/>
<circle cx="${x}" cy="${Y}" r="6" fill="${C.ink}" stroke="${C.steel2}" stroke-width="2"/>
<circle cx="${x}" cy="${Y}" r="5" fill="${C.gold}" filter="url(#glowBig)" class="ignite" style="animation-delay:${t}s"/>
<g class="up" style="animation-delay:${r1(t + 0.1)}s">
  <text x="${x}" y="${yearY}" text-anchor="middle" class="m" font-size="11.5" letter-spacing="1.5" fill="${C.gold}">${esc(it.year)}</text>
  ${lines.map((l, j) => `<text x="${x}" y="${firstLine + j * 17}" text-anchor="middle" class="s" font-size="13" fill="${C.bone}">${esc(l)}</text>`).join('\n  ')}
</g>`;
  });
  const css = `
  @keyframes ignite{0%{transform:scale(0);opacity:0}40%{transform:scale(1.8);opacity:1}100%{transform:scale(1)}}
  .ignite{transform-box:fill-box;transform-origin:center;animation:ignite .7s cubic-bezier(.2,.8,.2,1) backwards}
  @keyframes sheen{0%{transform:translateX(0)}55%,100%{transform:translateX(${X1 - X0 + 240}px)}}
  .sheen{animation:sheen 6s ${r1(T + 1)}s ease-in-out infinite backwards}`;
  return svg(W, H, { css, fonts: [400], label: `Forged since 2019: ${items.map((it) => `${it.year}, ${it.title}`).join('; ')}.`, body });
}

// ---------- anvil.svg (tools) ----------
function anvil() {
  const W = 1000, groups = cfg.tools;
  const colW = (W - 72 - (groups.length - 1) * 16) / groups.length;
  let maxH = 0, body = '', n = 0;
  groups.forEach((g, gi) => {
    const x = 36 + gi * (colW + 16);
    let y = 70;
    let chips = '';
    let cx = x + 20;
    g.items.forEach((item) => {
      const w = Math.round(item.length * 7.6 + 30);
      if (cx + w > x + colW - 20) { cx = x + 20; y += 40; }
      const d = r1(0.4 + n * 0.11);
      chips += `
  <g class="up" style="animation-delay:${d}s">
    <rect x="${cx}" y="${y}" width="${w}" height="30" rx="4" fill="${C.ink}" stroke="${C.line2}"/>
    <rect x="${cx}" y="${y}" width="${w}" height="30" rx="4" fill="none" stroke="${C.gold}" filter="url(#glow)" opacity="0" class="strike" style="animation-delay:${r1(d + 0.15)}s"/>
    <text x="${cx + w / 2}" y="${y + 19.5}" text-anchor="middle" class="s" font-size="13.5" fill="${C.bone}">${esc(item)}</text>
  </g>`;
      cx += w + 8;
      n++;
    });
    maxH = Math.max(maxH, y + 30 + 22);
    body += `
<g class="up" style="animation-delay:${r1(0.1 + gi * 0.1)}s">
  <rect x="${x}" y="20" width="${r1(colW)}" height="__H__" rx="12" fill="${C.ink2}" stroke="${C.line}"/>
  <text x="${x + 20}" y="50" class="m" font-size="10.5" letter-spacing="2.4" fill="${C.mute}">${pad(gi + 1)} / ${esc(g.group.toUpperCase())}</text>
</g>${chips}`;
  });
  const H = maxH + 20;
  body = `<defs>${glow('glow', 3)}</defs>\n<rect x="1" y="1" width="${W - 2}" height="${H - 2}" rx="18" fill="${C.ink}" stroke="${C.line}"/>` + body.replaceAll('__H__', String(maxH - 20));
  const css = `
  @keyframes strike{0%{opacity:1}100%{opacity:0}}
  .strike{animation:strike 1.2s ease-out backwards}`;
  return svg(W, H, { css, fonts: [400], label: `Tools: ${groups.map((g) => `${g.group}: ${g.items.join(', ')}`).join('. ')}.`, body });
}

// ---------- contact buttons ----------
function button(c, i) {
  const W = 156, H = 46;
  const body = `<defs>${glow('glow', 2.5)}</defs>
<rect x="1" y="1" width="${W - 2}" height="${H - 2}" rx="23" fill="${C.ink2}" stroke="${C.line2}"/>
<circle cx="24" cy="23" r="3" fill="${C.ember}" filter="url(#glow)" class="pulse" style="animation-delay:${r1(i * 0.4)}s"/>
<text x="38" y="27.5" class="m" font-size="11.5" letter-spacing="2" fill="${C.bone}">${esc(c.label.toUpperCase())}</text>
<text x="${W - 22}" y="28" text-anchor="end" class="s" font-size="14" fill="${C.gold}">↗</text>`;
  return svg(W, H, { label: c.label, body });
}

// ---------- footer ----------
function footer() {
  const W = 1000, H = 110, S = 34 / 2488;
  const body = `<defs>${glow('glow', 4)}<linearGradient id="heat" gradientUnits="userSpaceOnUse" x1="2750" y1="80" x2="250" y2="2420">${heatStops()}</linearGradient></defs>
<line x1="36" x2="964" y1="16" y2="16" stroke="${C.line}"/>
<g transform="translate(${r1(500 - (2962 * S) / 2)} 32) scale(${S.toFixed(5)})" class="pulse"><path d="${MARK}" fill="url(#heat)"/></g>
<text x="500" y="92" text-anchor="middle" class="m" font-size="10.5" letter-spacing="2.4" fill="${C.mute}">MADE BY HAND, SINCE 2019 · © FORGE STUDIO · THINURA ANJANA</text>`;
  return svg(W, H, { label: 'Made by hand, since 2019. FORGE Studio, Thinura Anjana.', body });
}

// ---------- write ----------
await writeFile(path.join(OUT, 'forge.svg'), hero());
for (const [i, p] of cfg.code.entries()) await writeFile(path.join(OUT, `code-${i + 1}.svg`), codeCard(p, i));
for (const [i, p] of cfg.posters.entries()) await writeFile(path.join(OUT, `poster-${i + 1}.svg`), await posterCard(p, i));
await writeFile(path.join(OUT, 'timeline.svg'), timeline());
await writeFile(path.join(OUT, 'anvil.svg'), anvil());
for (const [i, c] of cfg.contact.entries()) await writeFile(path.join(OUT, `link-${c.label.toLowerCase()}.svg`), button(c, i));
await writeFile(path.join(OUT, 'footer.svg'), footer());
console.log(`Forged with data from ${fetchedAt}: heat ${heat.toFixed(2)} → ${temp}°C (${state}), ${week} contributions this week.`);
