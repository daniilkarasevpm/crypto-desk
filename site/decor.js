// Crypto Desk: love theme.
// Pixel-art hearts, doves and a cupid, drawn as tiny SVGs from text grids below.
// Purely decorative: nothing here touches prices or data.

// ---------- Palette: one letter per colour ----------
const PALETTE = {
  P: "#ff4fd8", // neon pink
  D: "#c026d3", // deep magenta (shade)
  H: "#ffd1f3", // highlight
  W: "#f5f3ff", // dove / wing white
  G: "#b4a7f5", // lavender shade
  K: "#1e1033", // eye
  O: "#fbbf24", // beak, arrow fletching
  Y: "#fde047", // cupid's curls
  S: "#ffc9b0", // skin
  B: "#22d3ee", // neon cyan bow and arrow shaft
};

// ---------- Sprites: "." is empty, every other letter is a pixel ----------
const HEART = [
  ".PP...PP.",
  "PHPP.PPPP",
  "PHPPPPPPP",
  "PPPPPPPDP",
  ".PPPPPDD.",
  "..PPPDD..",
  "...PDD...",
  "....D....",
];

// Dove flying right; two frames make the wings flap.
const DOVE_UP = [
  "......GW........",
  "......GWW.......",
  ".......GWW......",
  ".......GWWW.....",
  "........GWW..WW.",
  ".........W..WWKO",
  "WW....WWWWWWWWW.",
  ".WWWWWWWWWWWWW..",
  "..WWWWWWWWWWG...",
  "....GGWWWWG.....",
  "................",
  "................",
];
const DOVE_DOWN = [
  "................",
  "................",
  "................",
  "................",
  ".............WW.",
  "............WWKO",
  "WW....WWWWWWWWW.",
  ".WWWWWWWWWWWWW..",
  "..WWWWWGWWWWG...",
  "....GWWWGG......",
  "......GWWG......",
  ".......GW.......",
];

// Cupid facing left with his bow; two frames for the wings.
const CUPID_UP = [
  ".....YYYY.......",
  "....YYYYYY......",
  "....YSSSSY...WW.",
  "....SKSSSS..WWWW",
  "....SSSSSS.WWWWG",
  ".....SSSS.WWWWG.",
  "..B...SSSSWWWG..",
  ".B.SSSSSSSSWG...",
  "B....SSSSSS.....",
  "B....PPPPPP.....",
  "B....PPPPPP.....",
  ".B....SS.SS.....",
  "..B...SS.SS.....",
  "......SS..SS....",
];
const CUPID_DOWN = [
  ".....YYYY.......",
  "....YYYYYY......",
  "....YSSSSY......",
  "....SKSSSS......",
  "....SSSSSS......",
  ".....SSSS.......",
  "..B...SSSSWWWWG.",
  ".B.SSSSSSSSWWWWG",
  "B....SSSSSSWWWG.",
  "B....PPPPPPWWG..",
  "B....PPPPPP.....",
  ".B....SS.SS.....",
  "..B...SS.SS.....",
  "......SS..SS....",
];

const ARROW = [
  "..P.P.......O.O",
  ".PPPPPBBBBBBBOO",
  "..PPP.......O.O",
  "...P...........",
];

// Turns a text grid into SVG rectangles (one per pixel).
function pixels(grid, extra = "") {
  let rects = "";
  grid.forEach((row, y) => {
    [...row].forEach((ch, x) => {
      if (PALETTE[ch]) rects += `<rect x="${x}" y="${y}" width="1.02" height="1.02" fill="${PALETTE[ch]}"/>`;
    });
  });
  return `<g ${extra}>${rects}</g>`;
}

function sprite(frames, className) {
  const w = frames[0][0].length, h = frames[0].length;
  const body = frames.length === 1
    ? pixels(frames[0])
    : pixels(frames[0], 'class="frame-a"') + pixels(frames[1], 'class="frame-b"');
  return `<svg class="${className}" viewBox="0 0 ${w} ${h}" shape-rendering="crispEdges" aria-hidden="true">${body}</svg>`;
}

const rand = (min, max) => min + Math.random() * (max - min);
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// ---------- 1. Pixel heart next to the title ----------
document.querySelector(".topbar h1")?.insertAdjacentHTML("afterbegin", sprite([HEART], "title-heart"));
document.querySelectorAll(".love-heart").forEach(el => (el.innerHTML = sprite([HEART], "mini-heart")));

// ---------- 2. Hearts slowly floating up behind the dashboard ----------
const sky = document.createElement("div");
sky.className = "sky";
sky.setAttribute("aria-hidden", "true");
document.body.prepend(sky);

const heartCount = reducedMotion ? 0 : window.innerWidth < 720 ? 8 : 16;
for (let i = 0; i < heartCount; i++) {
  const el = document.createElement("div");
  el.className = "float-heart" + (Math.random() < 0.3 ? " cyan" : "");
  el.innerHTML = sprite([HEART], "");
  const size = rand(12, 30);
  el.style.cssText = `left:${rand(0, 100)}%;width:${size}px;` +
    `animation-duration:${rand(16, 30)}s;animation-delay:${-rand(0, 30)}s;opacity:${rand(0.15, 0.4)}`;
  sky.append(el);
}

// ---------- 3. Doves and cupid live in the header ----------
const topbar = document.querySelector(".topbar");
const stage = document.createElement("div");
stage.className = "stage";
stage.setAttribute("aria-hidden", "true");
topbar.prepend(stage);

if (!reducedMotion) {
  // Two doves cross the header, staggered.
  [0, 9].forEach((delay, i) => {
    const dove = document.createElement("div");
    dove.className = "dove";
    dove.style.animationDelay = `${delay}s`;
    dove.style.top = i ? "calc(100% - 22px)" : "2px"; // fly in the margins, clear of the text
    dove.innerHTML = sprite([DOVE_UP, DOVE_DOWN], "");
    stage.append(dove);
  });
}

const cupid = document.createElement("button");
cupid.className = "cupid";
cupid.type = "button";
cupid.title = "Click me";
cupid.innerHTML = sprite([CUPID_UP, CUPID_DOWN], "");
topbar.append(cupid);

// Cupid shoots a heart-tipped arrow every ~12 seconds.
function shoot() {
  const arrow = document.createElement("div");
  arrow.className = "arrow";
  arrow.innerHTML = sprite([ARROW], "");
  const box = cupid.getBoundingClientRect(), bar = topbar.getBoundingClientRect();
  arrow.style.left = `${box.left - bar.left - 20}px`;
  arrow.style.top = `${box.top - bar.top + box.height * 0.45}px`;
  stage.append(arrow);
  arrow.addEventListener("animationend", () => arrow.remove());
}
if (!reducedMotion) setInterval(shoot, 12000), setTimeout(shoot, 2500);

// Click the cupid: a burst of hearts.
cupid.addEventListener("click", () => {
  const box = cupid.getBoundingClientRect();
  for (let i = 0; i < 12; i++) {
    const h = document.createElement("div");
    h.className = "burst-heart";
    h.innerHTML = sprite([HEART], "");
    const angle = (i / 12) * Math.PI * 2;
    h.style.left = `${box.left + box.width / 2}px`;
    h.style.top = `${box.top + box.height / 2}px`;
    h.style.setProperty("--dx", `${Math.cos(angle) * rand(50, 110)}px`);
    h.style.setProperty("--dy", `${Math.sin(angle) * rand(50, 110)}px`);
    document.body.append(h);
    h.addEventListener("animationend", () => h.remove());
  }
  if (!reducedMotion) shoot();
});
