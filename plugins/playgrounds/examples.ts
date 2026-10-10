import type { AnswerDocument, Expression } from "./model.js";

const ref = (ref: string): Expression => ({ ref });
const op = (
  op: Exclude<Expression, number | { ref: string }>["op"],
  ...args: Expression[]
): Expression => ({ op, args });
export const savings: AnswerDocument = {
  title: "Give your savings time to grow",
  description:
    "Explore how a starting balance could grow with annual compounding. Change the rate to compare scenarios.",
  controls: [
    {
      id: "principal",
      type: "number",
      label: "Starting balance",
      min: 0,
      max: 1000000,
      step: 100,
      value: 10000,
      unit: "$",
    },
    {
      id: "rate",
      type: "range",
      label: "Annual return",
      min: 0,
      max: 15,
      step: 0.5,
      value: 5,
      unit: "%",
    },
    {
      id: "years",
      type: "range",
      label: "Time to grow",
      min: 1,
      max: 30,
      step: 1,
      value: 20,
      unit: "years",
    },
  ],
  calculations: [
    { id: "growth", value: op("add", 1, op("divide", ref("rate"), 100)) },
    {
      id: "total",
      value: op(
        "multiply",
        ref("principal"),
        op("power", ref("growth"), ref("years")),
      ),
    },
    { id: "interest", value: op("subtract", ref("total"), ref("principal")) },
  ],
  blocks: [
    {
      type: "metrics",
      items: [
        {
          label: "Future balance",
          value: ref("total"),
          format: { prefix: "$", decimals: 0 },
        },
        {
          label: "Interest earned",
          value: ref("interest"),
          format: { prefix: "$", decimals: 0 },
        },
      ],
    },
    {
      type: "chart",
      title: "Growth over your chosen time horizon",
      style: "line",
      labels: ["Start", "¼", "Halfway", "¾", "End"],
      format: { prefix: "$", decimals: 0 },
      series: [
        {
          label: "Balance",
          values: [0, 0.25, 0.5, 0.75, 1].map((fraction) =>
            op(
              "multiply",
              ref("principal"),
              op(
                "power",
                ref("growth"),
                op("multiply", ref("years"), fraction),
              ),
            ),
          ),
        },
        {
          label: "Starting balance",
          values: Array.from({ length: 5 }, () => ref("principal")),
        },
      ],
    },
    {
      type: "details",
      title: "How this estimate works",
      text: "Balance = starting balance × (1 + annual return ÷ 100) ^ years. This illustration assumes a constant return and annual compounding, with no additional deposits, fees, taxes, or inflation. Returns are hypothetical, not guaranteed.",
    },
  ],
};
export const bill: AnswerDocument = {
  title: "Split dinner fairly",
  description:
    "Adjust the bill, tip, and group size. Everyone's share updates instantly.",
  controls: [
    {
      id: "bill",
      type: "number",
      label: "Bill before tip",
      min: 0,
      max: 10000,
      step: 0.01,
      value: 120,
      unit: "$",
    },
    {
      id: "tip",
      type: "range",
      label: "Tip",
      min: 0,
      max: 40,
      step: 1,
      value: 20,
      unit: "%",
    },
    {
      id: "people",
      type: "number",
      label: "People",
      min: 1,
      max: 50,
      step: 1,
      value: 4,
    },
    {
      id: "view",
      type: "select",
      label: "Breakdown",
      value: "chart",
      options: [
        { value: "chart", label: "Chart" },
        { value: "table", label: "Table" },
      ],
    },
  ],
  calculations: [
    {
      id: "tip_amount",
      value: op("divide", op("multiply", ref("bill"), ref("tip")), 100),
    },
    { id: "total", value: op("add", ref("bill"), ref("tip_amount")) },
  ],
  blocks: [
    {
      type: "metrics",
      items: [
        {
          label: "Per person",
          value: op("divide", ref("total"), ref("people")),
          format: { prefix: "$", decimals: 2 },
        },
        {
          label: "Total with tip",
          value: ref("total"),
          format: { prefix: "$", decimals: 2 },
        },
      ],
    },
    {
      type: "chart",
      title: "What you're paying",
      style: "bar",
      labels: ["Bill", "Tip"],
      series: [{ label: "Amount", values: [ref("bill"), ref("tip_amount")] }],
      format: { prefix: "$", decimals: 2 },
      when: { control: "view", equals: "chart" },
    },
    {
      type: "table",
      title: "The breakdown",
      columns: ["Item", "Amount"],
      rows: [
        ["Bill", ref("bill")],
        ["Tip", ref("tip_amount")],
        ["Total", ref("total")],
      ],
      format: { prefix: "$", decimals: 2 },
      when: { control: "view", equals: "table" },
    },
    {
      type: "text",
      text: "Shares are rounded to cents. Settle any rounding difference with one person.",
    },
  ],
};

export const stepper = {
  title: "Repot a houseplant",
  width: 520,
  html: `<style>
.steps { margin-top: 16px; padding: 16px; }
.steps h3 { margin: 10px 0 4px; font-size: 15px; font-weight: 500; }
.steps p { margin: 0; color: var(--muted-foreground); }
footer { display: flex; align-items: center; justify-content: space-between; margin-top: 16px; }
</style>
<h2 class="pg-title">Repot a houseplant</h2>
<p class="pg-subtitle">Three steps, about 15 minutes.</p>
<section class="steps pg-panel" aria-live="polite"><span class="pg-eyebrow" id="count"></span><h3 id="name"></h3><p id="text"></p></section>
<footer><div class="pg-dots" id="dots"></div><div><button class="pg-btn" id="back">Back</button> <button class="pg-btn pg-btn-primary" id="next">Next →</button></div></footer>
<script>
const steps = [["Water the day before", "Moist roots slide out of the old pot without tearing."], ["Loosen the root ball", "Tease circling roots apart with your fingers."], ["Set it at the same depth", "Fill around the roots with fresh mix and water until it drains."]];
let step = Math.min(steps.length - 1, Math.max(0, playground.state?.step ?? 0));
const $ = (id) => document.getElementById(id);
$("dots").innerHTML = steps.map(() => "<i></i>").join("");
function show() {
  $("count").textContent = "Step " + (step + 1) + " of " + steps.length;
  [$("name").textContent, $("text").textContent] = steps[step];
  [...$("dots").children].forEach((dot, i) => i === step ? dot.setAttribute("aria-current", "step") : dot.removeAttribute("aria-current"));
  $("back").disabled = step === 0; $("next").disabled = step === steps.length - 1;
  playground.save({ step });
}
$("back").onclick = () => { step--; show(); };
$("next").onclick = () => { step++; show(); };
show();
</script>`,
};
