import { DEMO_COMMITS, DATASET_SUMMARY } from "./demo-data.js";

const VARIANTS = [
  {
    id: "compact",
    tab: "1 · Compact lanes",
    module: "./variant-compact.js",
    pros: [
      "Densest information density — 28px rows like the production panel",
      "Deterministic lane colors, stable across pagination and refresh",
      "Header + column alignment matches VS Code Git Graph muscle memory",
    ],
    cons: [
      "Hard S-curves can look mechanical at wide lane counts",
      "No ancestry highlighting without extra wiring",
    ],
  },
  {
    id: "curve",
    tab: "2 · Smooth curveBumpY",
    module: "./variant-curve.js",
    pros: [
      "Ribbon-like D3 curveBumpY joins read as flowing history",
      "Hover highlights the entire ancestry chain and dims the rest",
      "Merge commits carry a dashed ring for instant recognition",
    ],
    cons: [
      "Taller rows (38px) show fewer commits per screen",
      "The smooth curves need more horizontal room per lane",
    ],
  },
  {
    id: "dag",
    tab: "3 · Top-down DAG",
    module: "./variant-dag.js",
    pros: [
      "Forks and merges are explicit: labeled nodes, dashed second-parent edges",
      "True DAG layout — both parents always drawn, never collapsed to a tree",
      "Hover lights the commit's full upstream and downstream",
    ],
    cons: [
      "Wide histories need horizontal scrolling",
      "Less suited to a long linear list view inside a side panel",
    ],
  },
];

const chips = document.querySelector("#chips");
for (const item of DATASET_SUMMARY) {
  const chip = document.createElement("span");
  chip.className = "gg-chip";
  chip.textContent = item;
  chips.appendChild(chip);
}

const tabs = document.querySelector("#tabs");
const stage = document.querySelector("#stage");
const blurb = document.querySelector("#blurb");
const notes = document.querySelector("#notes");

for (const variant of VARIANTS) {
  const button = document.createElement("button");
  button.className = "gg-tab";
  button.setAttribute("role", "tab");
  button.textContent = variant.tab;
  button.addEventListener("click", () => {
    void activate(variant);
  });
  tabs.appendChild(button);
}

for (const variant of VARIANTS) {
  const note = document.createElement("article");
  note.className = "gg-note";
  note.id = `note-${variant.id}`;
  const list = (items, cls) =>
    items.map((item) => `<li class="${cls}">${item}</li>`).join("");
  note.innerHTML = `
    <h3>${variant.tab}</h3>
    <ul>${list(variant.pros, "plus")}${list(variant.cons, "minus")}</ul>
  `;
  notes.appendChild(note);
}

let activeInstance = null;

async function activate(variant) {
  for (const button of tabs.children) {
    button.setAttribute(
      "aria-selected",
      button.textContent === variant.tab ? "true" : "false",
    );
  }
  for (const note of notes.children) {
    note.classList.toggle("current", note.id === `note-${variant.id}`);
  }
  if (activeInstance !== null) {
    activeInstance.destroy();
    activeInstance = null;
  }
  stage.replaceChildren();
  const mod = await import(variant.module);
  blurb.textContent = mod.blurb;
  activeInstance = mod.render({
    stage,
    commits: DEMO_COMMITS,
    d3: window.d3,
  });
}

await activate(VARIANTS[0]);
